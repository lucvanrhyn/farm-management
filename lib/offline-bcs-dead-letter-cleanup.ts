/**
 * lib/offline-bcs-dead-letter-cleanup.ts — Issue #426 + Issue #435 + Issue #449.
 *
 * Boot-time dead-letter cleanup. Two classes of permanently-stuck queue rows
 * are drained on mount:
 *
 *   Class A (Issue #426 / PR #332): pre-fix BCS `INVALID_TYPE` rows queued
 *   before 2026-05-18T11:47:00Z. The registry fix landed but the three
 *   already-stuck rows on Basson (×2) and Trio B (×1) must be discarded
 *   once. Predicate: `isPreFixBcsDeadLetter`.
 *
 *   Class B (Issue #435): any row that carried a 422 DUPLICATE_OBSERVATION
 *   response in `lastError` AND is older than 6 hours. These should have been
 *   auto-resolved by the sync-manager classifier (which now calls
 *   `markSucceeded` on them), but rows queued before that fix shipped, and any
 *   edge cases where the background sync fires before the classifier update is
 *   live, land here as a safety net. The 6h grace window prevents the cleanup
 *   from racing with a newly-stuck row that the classifier will resolve on the
 *   next sync cycle. Predicate: `isTerminalDuplicateDeadLetter`.
 *
 * Both predicates are pure functions. The generalized driver
 * `runDeadLetterCleanup` runs both in a single IDB pass. Issue #449 removed
 * the legacy `cleanupPreFixBcsDeadLetters` v1 driver — `OfflineProvider` now
 * wires v2 directly, and v2 subsumes v1.
 *
 * Belt-and-suspenders
 * ───────────────────
 * `discardFailedObservation` is internally gated to terminal-4xx rows only
 * (#324), so even a predicate mis-fire can only drop rows that were already
 * classified as poison.
 *
 * Per-mount drain (Issue #457)
 * ────────────────────────────
 * The driver previously short-circuited on a GLOBAL (un-tenant-scoped)
 * localStorage flag `offline-dead-letter-cleanup-v2`: once any farm's mount ran
 * the sweep, the flag was set and every subsequent invocation returned
 * `{ removed: 0 }` without touching IDB. In a shared browser profile that
 * meant a SECOND farm's eligible dead-letter rows (e.g. Trio B's stuck
 * "Failed: 2") were never drained — the global flag suppressed their sweep
 * forever. IndexedDB is per-origin, not per-tenant, so the flag could never
 * tell whether THIS tenant's rows had been handled.
 *
 * The run-once short-circuit is therefore removed: the predicate-driven sweep
 * runs on EVERY invocation. This is cheap (one read of the small `failed`
 * bucket plus a filtered set of `discardFailedObservation` calls) and
 * idempotent — `discardFailedObservation` structurally deletes only
 * terminal-4xx rows, so re-running on every mount can never drop a retryable
 * row. There is no localStorage flag anymore.
 */

import {
  getFailedObservations,
  discardFailedObservation,
} from '@/lib/offline-store';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * PR #332 (commit `742cf32`) shipped the registry fix on 2026-05-18. Any BCS
 * row queued strictly BEFORE this ISO timestamp predates the fix and is the
 * class-A cleanup target.
 */
const PRE_FIX_CUTOFF_ISO = '2026-05-18T11:47:00Z';

/**
 * Grace window for class-B DUPLICATE rows. Rows younger than this are
 * left alone — the sync-manager classifier will auto-resolve them on the
 * next background sync cycle (within seconds to minutes on a connected
 * device). Only rows older than 6h are discarded as unrecoverable dead-letters.
 */
const DUPLICATE_GRACE_WINDOW_MS = 6 * 60 * 60 * 1_000;

// ── Predicates ────────────────────────────────────────────────────────────────

/**
 * Class A predicate (Issue #426) — true iff the row is a pre-fix BCS
 * dead-letter. All four clauses must hold; weakening any of them broadens
 * the blast radius beyond the intended legacy population.
 */
export function isPreFixBcsDeadLetter(row: {
  type: string;
  lastStatusCode: number | null;
  lastError: string | null;
  created_at: string;
}): boolean {
  // (1) Only BCS observations — the only known stuck class.
  if (row.type !== 'body_condition_score') return false;
  // (2) Only terminal validation rejections — every stuck row carries HTTP 422.
  if (row.lastStatusCode !== 422) return false;
  // (3) Only the specific `INVALID_TYPE` wire error.
  if (!row.lastError || !row.lastError.includes('INVALID_TYPE')) return false;
  // (4) Only rows created before PR #332's deploy.
  if (row.created_at >= PRE_FIX_CUTOFF_ISO) return false;
  return true;
}

/**
 * Class B predicate (Issue #435) — true iff the row is a DUPLICATE_OBSERVATION
 * dead-letter old enough to safely discard.
 *
 * Two clauses:
 *   (1) HTTP 422 with `DUPLICATE_OBSERVATION` in `lastError`.
 *   (2) Row is older than the 6h grace window so we don't race the classifier.
 */
export function isTerminalDuplicateDeadLetter(row: {
  lastStatusCode: number | null;
  lastError: string | null;
  created_at: string;
}): boolean {
  // (1) 422 DUPLICATE_OBSERVATION
  if (row.lastStatusCode !== 422) return false;
  if (!row.lastError || !row.lastError.includes('DUPLICATE_OBSERVATION')) return false;
  // (2) Older than the grace window
  const rowMs = Date.parse(row.created_at);
  if (Number.isNaN(rowMs)) return false;
  if (Date.now() - rowMs < DUPLICATE_GRACE_WINDOW_MS) return false;
  return true;
}

// ── Drivers ───────────────────────────────────────────────────────────────────

/**
 * Generalized dead-letter cleanup (Issue #435 + Issue #457).
 *
 * Walks all failed rows, applies both predicates (class A + class B), and
 * discards candidates in a single IDB pass. SSR-safe and failure-isolated.
 *
 * Issue #457 — runs on EVERY invocation. There is no run-once localStorage
 * flag: a global per-origin flag could not distinguish whether THIS tenant's
 * rows had already been drained, so it suppressed a second farm's sweep in a
 * shared browser profile. The sweep is cheap and idempotent — the predicates
 * stay narrow and `discardFailedObservation` structurally deletes only
 * terminal-4xx rows — so re-running every mount (and on every
 * `FailedSyncDialog` open) is safe.
 *
 * Resolves with `{ removed }` — the number of rows actually deleted. Never
 * throws.
 */
export async function runDeadLetterCleanup(): Promise<{ removed: number }> {
  if (typeof window === 'undefined') return { removed: 0 };

  try {
    const failed = await getFailedObservations();
    const candidates = failed.filter(
      (row) => isPreFixBcsDeadLetter(row) || isTerminalDuplicateDeadLetter(row),
    );

    for (const row of candidates) {
      if (row.local_id != null) {
        await discardFailedObservation(row.local_id);
      }
    }

    return { removed: candidates.length };
  } catch (err) {
    console.warn('[offline] dead-letter cleanup failed:', err);
    return { removed: 0 };
  }
}

