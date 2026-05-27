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
 * Idempotency
 * ───────────
 * `runDeadLetterCleanup` uses `offline-dead-letter-cleanup-v2` as its flag
 * key. The legacy `offline-cleanup-bcs-pre-fix-422-v1` key from PR #433 is
 * intentionally left untouched on devices that already ran v1; v2's flag is
 * orthogonal, so v2 will still run once on those devices and drain any
 * subsequently-stuck class-B rows. Subsequent calls short-circuit on v2's
 * flag.
 */

import {
  getFailedObservations,
  discardFailedObservation,
} from '@/lib/offline-store';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * v2 flag — set after the first successful generalized cleanup pass.
 * Subsumes v1: if v2 is set, both class A and class B have been handled.
 */
const CLEANUP_FLAG_KEY = 'offline-dead-letter-cleanup-v2';

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
 * Generalized boot-time dead-letter cleanup (Issue #435).
 *
 * Walks all failed rows, applies both predicates (class A + class B), and
 * discards candidates in a single IDB pass. SSR-safe, idempotent via
 * localStorage `offline-dead-letter-cleanup-v2`, failure-isolated.
 *
 * Resolves with `{ removed }` — the number of rows actually deleted. Never
 * throws.
 */
export async function runDeadLetterCleanup(): Promise<{ removed: number }> {
  if (typeof window === 'undefined') return { removed: 0 };

  try {
    if (window.localStorage?.getItem(CLEANUP_FLAG_KEY) === 'done') {
      return { removed: 0 };
    }

    const failed = await getFailedObservations();
    const candidates = failed.filter(
      (row) => isPreFixBcsDeadLetter(row) || isTerminalDuplicateDeadLetter(row),
    );

    for (const row of candidates) {
      if (row.local_id != null) {
        await discardFailedObservation(row.local_id);
      }
    }

    window.localStorage?.setItem(CLEANUP_FLAG_KEY, 'done');
    return { removed: candidates.length };
  } catch (err) {
    console.warn('[offline] dead-letter cleanup failed:', err);
    return { removed: 0 };
  }
}

