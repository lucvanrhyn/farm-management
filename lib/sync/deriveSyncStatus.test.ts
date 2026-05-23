/**
 * @vitest-environment node
 *
 * Issue #395 — pure `deriveSyncStatus` deriver.
 *
 * Locks the six-rule table from the issue acceptance criteria so the
 * LoggerStatusBar never again shows "Synced" while the queue holds pending
 * or failed work. The deriver replaces the inline status computation that
 * lived in the component.
 *
 * Rules pinned here (issue body verbatim):
 *   - empty queue + recent success → `fresh`
 *   - pending > 0 + online → `syncing`
 *   - failed > 0 → `failed`
 *   - offline → `offline`
 *   - empty queue + stale lastSuccessAt → `stale`
 *   - mixed pending + failed → `partial`
 */
import { describe, it, expect } from 'vitest';

import {
  deriveSyncStatus,
  STALE_THRESHOLD_MS,
  type DerivableQueueEntry,
} from './deriveSyncStatus';

// ── Fixtures ────────────────────────────────────────────────────────────────

// A stable "now" so the table rows don't drift with wall-clock time. Every
// test passes `now` explicitly via `Date.now()` mock substitution by deriving
// timestamps off this anchor. The deriver itself reads `Date.now()` only for
// the staleness check, which we control by setting `lastFullSuccessAt` to a
// known offset.
const NOW = 1_700_000_000_000; // arbitrary fixed epoch-ms anchor
const ONE_HOUR_MS = 60 * 60 * 1_000;

function withNow<T>(now: number, fn: () => T): T {
  const realNow = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

function entry(
  status: 'pending' | 'synced' | 'failed',
  createdAt: string | undefined = undefined,
): DerivableQueueEntry {
  return { sync_status: status, created_at: createdAt };
}

// ── Rule table ──────────────────────────────────────────────────────────────

describe('deriveSyncStatus — six-rule table (#395)', () => {
  it('rule 1: empty queue + recent success → fresh', () => {
    const descriptor = withNow(NOW, () =>
      deriveSyncStatus([], NOW - 5 * 60_000 /* 5 min ago */, true),
    );
    expect(descriptor.kind).toBe('fresh');
    expect(descriptor.counts).toEqual({ pending: 0, failed: 0, today: 0 });
    expect(descriptor.lastSuccessAt).toBe(NOW - 5 * 60_000);
  });

  it('rule 2: pending > 0 + online → syncing', () => {
    const queue = [entry('pending'), entry('pending'), entry('pending')];
    const descriptor = withNow(NOW, () =>
      deriveSyncStatus(queue, NOW - 5 * 60_000, true),
    );
    expect(descriptor.kind).toBe('syncing');
    expect(descriptor.counts.pending).toBe(3);
    expect(descriptor.counts.failed).toBe(0);
  });

  it('rule 3: failed > 0 (no pending) + online → failed', () => {
    const queue = [entry('failed'), entry('failed')];
    const descriptor = withNow(NOW, () => deriveSyncStatus(queue, NOW, true));
    expect(descriptor.kind).toBe('failed');
    expect(descriptor.counts.failed).toBe(2);
    expect(descriptor.counts.pending).toBe(0);
  });

  it('rule 4: offline → offline (regardless of queue contents)', () => {
    // Offline beats every other rule — a farmer in a dead-zone needs to see
    // "Offline" even with pending or failed rows queued.
    const queueScenarios: ReadonlyArray<DerivableQueueEntry[]> = [
      [],
      [entry('pending')],
      [entry('failed')],
      [entry('pending'), entry('failed')],
    ];
    for (const queue of queueScenarios) {
      const descriptor = withNow(NOW, () => deriveSyncStatus(queue, NOW, false));
      expect(descriptor.kind).toBe('offline');
    }
  });

  it('rule 5: empty queue + stale lastFullSuccessAt → stale', () => {
    const longAgo = NOW - (STALE_THRESHOLD_MS + ONE_HOUR_MS);
    const descriptor = withNow(NOW, () => deriveSyncStatus([], longAgo, true));
    expect(descriptor.kind).toBe('stale');
    expect(descriptor.lastSuccessAt).toBe(longAgo);
  });

  it('rule 5b: empty queue + null lastFullSuccessAt → stale (never synced)', () => {
    // A device that has never completed a successful cycle is "stale" — the
    // farmer should know the app has not yet proved it can reach the server.
    const descriptor = withNow(NOW, () => deriveSyncStatus([], null, true));
    expect(descriptor.kind).toBe('stale');
    expect(descriptor.lastSuccessAt).toBeNull();
  });

  it('rule 6: mixed pending + failed → partial', () => {
    const queue = [entry('pending'), entry('pending'), entry('failed')];
    const descriptor = withNow(NOW, () => deriveSyncStatus(queue, NOW, true));
    expect(descriptor.kind).toBe('partial');
    expect(descriptor.counts.pending).toBe(2);
    expect(descriptor.counts.failed).toBe(1);
  });
});

// ── Precedence / edge cases ──────────────────────────────────────────────────

describe('deriveSyncStatus — precedence + edge cases', () => {
  it('partial wins over failed when both pending AND failed are present', () => {
    // Pinning precedence so a future refactor that re-orders the branches
    // gets a loud signal — `failed` would otherwise swallow a `partial`
    // signal and the farmer would lose the "12 pending" half of the message.
    const queue = [entry('pending'), entry('failed')];
    const descriptor = withNow(NOW, () => deriveSyncStatus(queue, NOW, true));
    expect(descriptor.kind).toBe('partial');
  });

  it('offline wins over partial / failed / syncing / stale', () => {
    const queue = [entry('pending'), entry('failed')];
    // Even with a stuck queue AND a stale lastSuccess, offline is the answer.
    const descriptor = withNow(NOW, () =>
      deriveSyncStatus(queue, NOW - 10 * STALE_THRESHOLD_MS, false),
    );
    expect(descriptor.kind).toBe('offline');
  });

  it('synced rows are not counted in pending or failed totals', () => {
    // Rows that have already landed must not pollute the counts the farmer
    // sees — `pendingCount`/`failedCount` are queue-state counts, not
    // lifetime counters.
    const queue = [entry('synced'), entry('synced'), entry('pending')];
    const descriptor = withNow(NOW, () => deriveSyncStatus(queue, NOW, true));
    expect(descriptor.counts.pending).toBe(1);
    expect(descriptor.counts.failed).toBe(0);
  });

  it("counts today = entries created since local midnight (regardless of sync_status)", () => {
    // `today` is the farmer's "what did I log today" feeling — it must
    // include rows that have already synced today, AND rows still queued.
    //
    // Anchor everything via Date constructors that take LOCAL components so
    // the test passes regardless of the runner's timezone (CI is UTC; the
    // dev machine may be SAST / PST / wherever).
    const todayAfternoon = new Date(2026, 4, 23, 15, 30); // local 15:30
    const todayMorning = new Date(2026, 4, 23, 6, 0); // local 06:00
    const yesterdayMidday = new Date(2026, 4, 22, 12, 0); // local 12:00 yesterday
    const now = todayAfternoon.getTime();
    const queue = [
      entry('synced', todayMorning.toISOString()),
      entry('pending', todayMorning.toISOString()),
      entry('failed', yesterdayMidday.toISOString()),
    ];
    const descriptor = withNow(now, () => deriveSyncStatus(queue, now, true));
    expect(descriptor.counts.today).toBe(2);
  });

  it('today defaults to 0 when entries carry no created_at', () => {
    // Legacy rows queued before the timestamp field was reliable must not
    // crash the deriver — they simply don't count toward "today".
    const queue = [entry('pending'), entry('failed')];
    const descriptor = withNow(NOW, () => deriveSyncStatus(queue, NOW, true));
    expect(descriptor.counts.today).toBe(0);
  });

  it('descriptor.lastSuccessAt is passed through unchanged', () => {
    // The component renders this via formatRelativeTime — the deriver does
    // not pre-format. Round-trip the value to lock the contract.
    const ts = NOW - 7 * 60_000;
    const descriptor = withNow(NOW, () => deriveSyncStatus([], ts, true));
    expect(descriptor.lastSuccessAt).toBe(ts);
  });

  it('STALE_THRESHOLD_MS is exported and equals 24h', () => {
    // The threshold is a named constant so a refactor can tune it without
    // hunting for a magic number. Lock 24h as the current value — change
    // intentionally, with a code review.
    expect(STALE_THRESHOLD_MS).toBe(24 * 60 * 60 * 1_000);
  });
});
