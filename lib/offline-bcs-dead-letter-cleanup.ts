/**
 * Issue #426 — one-time cleanup helper for pre-fix BCS dead-letter rows.
 *
 * Background
 * ──────────
 * Before PR #332 (commit `742cf32`, 2026-05-18) the observation type registry
 * did not include `body_condition_score`, so any BCS observation queued offline
 * before that deploy now hits the server, gets HTTP 422 `INVALID_TYPE`, and is
 * permanently parked in the failed bucket by the sync queue's terminal-4xx
 * policy (#324). The visible symptom is "Failed: N" badges on affected devices
 * — Basson Boerdery (×2) and Trio B Boerdery (×1) at the time of writing.
 *
 * PR #332 fixed the root cause (new submissions go through cleanly), but the
 * three pre-existing rows still sit in IndexedDB on each device. This helper
 * runs once on boot, identifies those rows by a 4-clause predicate, and
 * discards them through the existing `discardFailedObservation` primitive.
 *
 * Belt-and-suspenders
 * ───────────────────
 * The predicate ANDs four conditions (type / status / error / pre-fix
 * timestamp). The timestamp cut-off — `2026-05-18T11:47:00Z` — caps the blast
 * radius to legacy rows so that even if a future bug ever re-introduces
 * 422-on-BCS, this cleanup won't silently swallow the new failures.
 *
 * Defense-in-depth: `discardFailedObservation` is internally gated to
 * terminal-4xx rows only (#324), so even a predicate mis-fire can only drop
 * rows that were already classified as poison.
 *
 * Idempotency
 * ───────────
 * The `offline-cleanup-bcs-pre-fix-422-v1` localStorage flag is set after the
 * first successful pass so the helper becomes a no-op on every subsequent
 * boot. The `v1` suffix exists so that if a future, similar one-time cleanup
 * lands (e.g. a different pre-fix dead-letter class), it can ship with `v2`
 * (or its own distinct key) without colliding.
 */

import {
  getFailedObservations,
  discardFailedObservation,
} from '@/lib/offline-store';

/** Set after the first successful cleanup so repeated boots are no-ops. */
const CLEANUP_FLAG_KEY = 'offline-cleanup-bcs-pre-fix-422-v1';

/**
 * PR #332 (commit `742cf32`) shipped the registry fix on 2026-05-18. Any BCS
 * row queued strictly BEFORE this ISO timestamp predates the fix and is the
 * cleanup target. Comparison is lexicographic on the ISO 8601 string — for
 * UTC-zone strings this matches calendar order, which is the only shape the
 * sync queue ever writes (`new Date().toISOString()`).
 */
const PRE_FIX_CUTOFF_ISO = '2026-05-18T11:47:00Z';

/**
 * Pure predicate — true iff the row is a pre-fix BCS dead-letter that is safe
 * to discard. All four clauses must hold; weakening any of them broadens the
 * blast radius beyond the intended legacy population.
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
  // (3) Only the specific `INVALID_TYPE` wire error — distinguishes the
  //     registry-mismatch class from any other 422 (e.g. field-required).
  //     Case-sensitive: server emits the code in uppercase.
  if (!row.lastError || !row.lastError.includes('INVALID_TYPE')) return false;
  // (4) Only rows created before PR #332's deploy. A post-fix row that 422s
  //     under the same code would be a NEW bug worth surfacing, not silently
  //     dropping.
  if (row.created_at >= PRE_FIX_CUTOFF_ISO) return false;
  return true;
}

/**
 * Boot-time driver. SSR-safe, idempotent, failure-isolated.
 *
 * Resolves with `{ removed }` — the number of rows actually deleted. Never
 * throws: any IDB / localStorage failure is logged via `console.warn` and the
 * helper returns `{ removed: 0 }` so the OfflineProvider mount path is never
 * broken by a cleanup mishap.
 */
export async function cleanupPreFixBcsDeadLetters(): Promise<{ removed: number }> {
  // SSR / non-browser environments: nothing to clean.
  if (typeof window === 'undefined') return { removed: 0 };

  try {
    // Already ran on this device — short-circuit before any IDB work so the
    // cleanup costs literally one localStorage read on every subsequent boot.
    if (window.localStorage?.getItem(CLEANUP_FLAG_KEY) === 'done') {
      return { removed: 0 };
    }

    const failed = await getFailedObservations();
    const candidates = failed.filter(isPreFixBcsDeadLetter);

    for (const row of candidates) {
      if (row.local_id != null) {
        await discardFailedObservation(row.local_id);
      }
    }

    window.localStorage?.setItem(CLEANUP_FLAG_KEY, 'done');
    return { removed: candidates.length };
  } catch (err) {
    // Defensive — never let a cleanup failure poison the OfflineProvider mount
    // path. The visible symptom (stuck Failed: N badge) is preferable to a
    // hard render crash. A re-run on the next boot will retry.
    // eslint-disable-next-line no-console
    console.warn('[offline] BCS pre-fix dead-letter cleanup failed:', err);
    return { removed: 0 };
  }
}
