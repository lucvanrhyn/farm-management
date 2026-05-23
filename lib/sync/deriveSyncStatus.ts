/**
 * lib/sync/deriveSyncStatus.ts — Issue #395.
 *
 * Pure derivation of the logger status-bar copy from three inputs:
 *   - the current offline queue (rows that haven't been confirmed synced)
 *   - `lastFullSuccessAt` epoch-ms (the PRD #194 SyncTruth field — only
 *     ticks on a zero-failure cycle, so it is the truthful "synced" anchor)
 *   - `navigator.onLine`
 *
 * Why this lives outside the component:
 *   Before #395, `LoggerStatusBar.tsx` derived the status inline. The right
 *   side always rendered "Synced: …" via `formatRelativeTime(lastSyncedAt)`
 *   regardless of pending or failed queue contents — a farmer with 12
 *   queued rows still saw a green "Synced: Just now" badge. Pulling the
 *   derivation out:
 *     1. The component becomes presentational (kind → copy).
 *     2. The six-rule table is locked by unit tests, not by reading JSX.
 *     3. A future surface (admin debug page, smoke test) can reuse the
 *        deriver without dragging in React.
 *
 * The deriver is intentionally synchronous and side-effect-free. It reads
 * `Date.now()` once for the staleness check; tests substitute Date.now to
 * pin behaviour at the boundary.
 */

export type SyncStatusKind =
  | 'fresh'
  | 'syncing'
  | 'partial'
  | 'stale'
  | 'failed'
  | 'offline';

export interface SyncStatusDescriptor {
  kind: SyncStatusKind;
  counts: {
    pending: number;
    failed: number;
    today: number;
  };
  /** Epoch-ms of the most recent full-success sync, or null if never. */
  lastSuccessAt: number | null;
}

/**
 * Structural minimum the deriver needs from a queued row. The real backing
 * types (`PendingObservation`, `PendingAnimalCreate`, `PendingCoverReading`,
 * `PendingPhoto`) all carry these two fields plus more. Staying structural
 * means a future queue kind opts in by matching the shape — no enum
 * update here.
 */
export interface DerivableQueueEntry {
  sync_status: 'pending' | 'synced' | 'failed';
  created_at?: string;
}

/**
 * Maximum age of a "still fresh" lastFullSuccessAt. Beyond this the empty
 * queue is reported as `stale` so the farmer knows the device hasn't
 * proved a successful round-trip in a long time (network blip, app sitting
 * in the background, etc.).
 *
 * 24h is the current value — change intentionally; the constant is locked
 * by `deriveSyncStatus.test.ts` so a refactor cannot drift it silently.
 */
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function countToday(queue: DerivableQueueEntry[], now: number): number {
  // Local midnight of `now` — `new Date(now)` uses the runtime's local zone,
  // which is the farmer's zone (the deriver runs in the logger client).
  const localMidnight = new Date(now);
  localMidnight.setHours(0, 0, 0, 0);
  const midnightMs = localMidnight.getTime();

  let count = 0;
  for (const entry of queue) {
    if (!entry.created_at) continue;
    const ms = Date.parse(entry.created_at);
    if (Number.isNaN(ms)) continue;
    if (ms >= midnightMs) count++;
  }
  return count;
}

function tallyCounts(
  queue: DerivableQueueEntry[],
  now: number,
): { pending: number; failed: number; today: number } {
  let pending = 0;
  let failed = 0;
  for (const entry of queue) {
    if (entry.sync_status === 'pending') pending++;
    else if (entry.sync_status === 'failed') failed++;
    // `synced` rows are not counted — they belong to the historical tally
    // (surfaced via `today` only).
  }
  return { pending, failed, today: countToday(queue, now) };
}

function pickKind(
  counts: { pending: number; failed: number },
  lastFullSuccessAt: number | null,
  isOnline: boolean,
  now: number,
): SyncStatusKind {
  // Precedence (locked by the test table):
  //   1. offline      — beats everything; a dead-zone farmer needs that signal
  //   2. partial      — both pending AND failed; preserves both halves of the
  //                     mixed message ("12 pending · 2 failed")
  //   3. failed       — failed-only; pending zero
  //   4. syncing      — pending-only; failed zero; online
  //   5. fresh        — empty queue, recent success
  //   6. stale        — empty queue, no success or success > STALE_THRESHOLD_MS
  if (!isOnline) return 'offline';
  if (counts.pending > 0 && counts.failed > 0) return 'partial';
  if (counts.failed > 0) return 'failed';
  if (counts.pending > 0) return 'syncing';

  // Queue empty — fresh vs stale on lastFullSuccessAt age.
  if (lastFullSuccessAt === null) return 'stale';
  if (now - lastFullSuccessAt > STALE_THRESHOLD_MS) return 'stale';
  return 'fresh';
}

// ── Public API ───────────────────────────────────────────────────────────────

export function deriveSyncStatus(
  queue: DerivableQueueEntry[],
  lastFullSuccessAt: number | null,
  isOnline: boolean,
): SyncStatusDescriptor {
  const now = Date.now();
  const counts = tallyCounts(queue, now);
  const kind = pickKind(counts, lastFullSuccessAt, isOnline, now);
  return {
    kind,
    counts,
    lastSuccessAt: lastFullSuccessAt,
  };
}

/**
 * Counts-first adapter for surfaces (like `LoggerStatusBar`) that already
 * receive `pendingCount` / `failedCount` via `useOffline()` and would have
 * to fabricate a queue array just to call the queue-based deriver.
 *
 * Behaviour matches `deriveSyncStatus` for the kind / counts.pending /
 * counts.failed / lastSuccessAt fields. The `today` field is set to the
 * supplied `todayCount` (zero if omitted) because the caller's view of the
 * queue has already collapsed individual rows into aggregate counts and
 * the per-row `created_at` field needed for a local-midnight tally is no
 * longer available at this surface.
 *
 * Why it lives alongside the queue-based deriver instead of inside the
 * component:
 *   The component must be presentational only — no `pickKind`-style branch
 *   logic in JSX. Centralising both flavours of derivation here keeps the
 *   six-rule table in one file, exercised by one test suite.
 */
export function deriveSyncStatusFromCounts(
  pending: number,
  failed: number,
  lastFullSuccessAt: number | null,
  isOnline: boolean,
  todayCount: number = 0,
): SyncStatusDescriptor {
  const now = Date.now();
  const counts = { pending, failed, today: todayCount };
  const kind = pickKind(counts, lastFullSuccessAt, isOnline, now);
  return {
    kind,
    counts,
    lastSuccessAt: lastFullSuccessAt,
  };
}
