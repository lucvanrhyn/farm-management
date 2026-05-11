// @vitest-environment jsdom
/**
 * Wave 195 / PRD #194 — RED test pinning the public contract of `lib/sync/queue.ts`.
 *
 * Why this module exists:
 *   The offline sync indicator has lied to users twice (Codex audit C1 + C3).
 *   Root cause was a caller-must-remember `tickLastSyncedAt` boolean threaded
 *   through `refreshCachedData` — two callers forgot to flip it on failed
 *   cycles, so the UI showed "Synced: Just now" while every queued row had
 *   actually failed.
 *
 *   This facade owns sync state derivation. The UI eventually reads a single
 *   `SyncTruth` value; the caller-must-remember bug is structurally impossible
 *   because the four kinds (observation / animal / photo / cover-reading)
 *   feed into one `recordSyncAttempt` call that derives `lastFullSuccessAt`
 *   from the per-kind results.
 *
 * Public contract (this test pins it):
 *
 *   getCurrentSyncTruth() → {
 *     pendingCount,        derived live from the four pending stores
 *     failedCount,         derived live from the four failed-status counts
 *     lastAttemptAt,       most recent recordSyncAttempt timestamp (any outcome)
 *     lastFullSuccessAt,   most recent recordSyncAttempt timestamp where ALL kinds had zero failures
 *   }
 *
 *   enqueuePending(kind, row)       → +1 pendingCount
 *   markSucceeded(kind, id, payload) → -1 pendingCount, no truth-tick
 *   markFailed(kind, id, reason)     → -1 pendingCount, +1 failedCount, no truth-tick
 *   recordSyncAttempt({ timestamp, perKindResults }) → ticks lastAttemptAt always;
 *                                                      ticks lastFullSuccessAt only when
 *                                                      every perKindResults entry has failed === 0
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SyncKind } from '@/lib/sync/queue';

beforeEach(() => {
  vi.resetModules();
});

async function loadQueueWithFreshFarm() {
  const store = await import('@/lib/offline-store');
  store.setActiveFarmSlug(`queue-test-${Math.random().toString(36).slice(2)}`);
  const queue = await import('@/lib/sync/queue');
  return { store, queue };
}

function makePendingObservation(localId = 1) {
  return {
    local_id: localId,
    type: 'weighing',
    camp_id: 'camp-1',
    details: '{}',
    created_at: '2026-05-11T08:00:00.000Z',
    synced_at: null,
    sync_status: 'pending' as const,
  };
}

function makePendingAnimalCreate(localId = 1) {
  return {
    local_id: localId,
    animal_id: `KALF-${localId}`,
    sex: 'Female',
    category: 'Calf',
    current_camp: 'camp-1',
    date_added: '2026-05-11',
    sync_status: 'pending' as const,
  };
}

function makePendingCoverReading(localId = 1) {
  return {
    local_id: localId,
    farm_slug: 'test',
    camp_id: 'camp-1',
    cover_category: 'Good' as const,
    created_at: '2026-05-11T08:00:00.000Z',
    sync_status: 'pending' as const,
  };
}

describe('lib/sync/queue — getCurrentSyncTruth (empty queue)', () => {
  it('returns zeros and null timestamps when nothing has been queued or attempted', async () => {
    const { queue } = await loadQueueWithFreshFarm();
    const truth = await queue.getCurrentSyncTruth();
    expect(truth.pendingCount).toBe(0);
    expect(truth.failedCount).toBe(0);
    expect(truth.lastAttemptAt).toBeNull();
    expect(truth.lastFullSuccessAt).toBeNull();
  });
});

describe('lib/sync/queue — enqueuePending', () => {
  it('increments pendingCount for an observation', async () => {
    const { queue } = await loadQueueWithFreshFarm();
    await queue.enqueuePending('observation', makePendingObservation());
    const truth = await queue.getCurrentSyncTruth();
    expect(truth.pendingCount).toBe(1);
    expect(truth.failedCount).toBe(0);
  });

  it('increments pendingCount across multiple kinds', async () => {
    const { queue } = await loadQueueWithFreshFarm();
    await queue.enqueuePending('observation', makePendingObservation(1));
    await queue.enqueuePending('animal', makePendingAnimalCreate(1));
    await queue.enqueuePending('cover-reading', makePendingCoverReading(1));
    const truth = await queue.getCurrentSyncTruth();
    expect(truth.pendingCount).toBe(3);
  });
});

describe('lib/sync/queue — markSucceeded', () => {
  it('decrements pendingCount and does not tick lastFullSuccessAt on its own', async () => {
    const { queue } = await loadQueueWithFreshFarm();
    await queue.enqueuePending('observation', makePendingObservation(7));
    await queue.markSucceeded('observation', 7, { id: 'srv-1' });
    const truth = await queue.getCurrentSyncTruth();
    expect(truth.pendingCount).toBe(0);
    expect(truth.failedCount).toBe(0);
    // Critical: row-level success must NOT tick the cycle-level timestamp.
    // Only recordSyncAttempt may move lastFullSuccessAt.
    expect(truth.lastFullSuccessAt).toBeNull();
    expect(truth.lastAttemptAt).toBeNull();
  });
});

describe('lib/sync/queue — markFailed', () => {
  it('decrements pendingCount, increments failedCount, no truth-tick', async () => {
    const { queue } = await loadQueueWithFreshFarm();
    await queue.enqueuePending('observation', makePendingObservation(9));
    await queue.markFailed('observation', 9, 'HTTP 422');
    const truth = await queue.getCurrentSyncTruth();
    expect(truth.pendingCount).toBe(0);
    expect(truth.failedCount).toBe(1);
    expect(truth.lastFullSuccessAt).toBeNull();
    expect(truth.lastAttemptAt).toBeNull();
  });
});

describe('lib/sync/queue — recordSyncAttempt', () => {
  it('all-success ticks both lastAttemptAt and lastFullSuccessAt', async () => {
    const { queue } = await loadQueueWithFreshFarm();
    const t = '2026-05-11T09:00:00.000Z';
    await queue.recordSyncAttempt({
      timestamp: t,
      perKindResults: {
        observation: { synced: 1, failed: 0 },
        animal: { synced: 0, failed: 0 },
        photo: { synced: 0, failed: 0 },
        'cover-reading': { synced: 0, failed: 0 },
      },
    });
    const truth = await queue.getCurrentSyncTruth();
    expect(truth.lastAttemptAt).toBe(t);
    expect(truth.lastFullSuccessAt).toBe(t);
  });

  it('any failure ticks lastAttemptAt but NOT lastFullSuccessAt', async () => {
    const { queue } = await loadQueueWithFreshFarm();
    const t = '2026-05-11T09:30:00.000Z';
    await queue.recordSyncAttempt({
      timestamp: t,
      perKindResults: {
        observation: { synced: 2, failed: 1 },
        animal: { synced: 0, failed: 0 },
        photo: { synced: 0, failed: 0 },
        'cover-reading': { synced: 0, failed: 0 },
      },
    });
    const truth = await queue.getCurrentSyncTruth();
    expect(truth.lastAttemptAt).toBe(t);
    expect(truth.lastFullSuccessAt).toBeNull();
  });

  it('multi-cycle: lastFullSuccessAt reflects the most recent fully-successful attempt, not the most recent attempt', async () => {
    const { queue } = await loadQueueWithFreshFarm();
    const t1 = '2026-05-11T10:00:00.000Z';
    const t2 = '2026-05-11T10:05:00.000Z';
    const t3 = '2026-05-11T10:10:00.000Z';

    // Cycle 1 — full success
    await queue.recordSyncAttempt({
      timestamp: t1,
      perKindResults: {
        observation: { synced: 1, failed: 0 },
        animal: { synced: 0, failed: 0 },
        photo: { synced: 0, failed: 0 },
        'cover-reading': { synced: 0, failed: 0 },
      },
    });
    // Cycle 2 — partial failure
    await queue.recordSyncAttempt({
      timestamp: t2,
      perKindResults: {
        observation: { synced: 0, failed: 1 },
        animal: { synced: 0, failed: 0 },
        photo: { synced: 0, failed: 0 },
        'cover-reading': { synced: 0, failed: 0 },
      },
    });
    // Cycle 3 — full success again
    await queue.recordSyncAttempt({
      timestamp: t3,
      perKindResults: {
        observation: { synced: 1, failed: 0 },
        animal: { synced: 0, failed: 0 },
        photo: { synced: 0, failed: 0 },
        'cover-reading': { synced: 0, failed: 0 },
      },
    });

    const truth = await queue.getCurrentSyncTruth();
    expect(truth.lastAttemptAt).toBe(t3);
    expect(truth.lastFullSuccessAt).toBe(t3);

    // Now run another partial-failure cycle — lastFullSuccessAt must hold steady at t3.
    const t4 = '2026-05-11T10:15:00.000Z';
    await queue.recordSyncAttempt({
      timestamp: t4,
      perKindResults: {
        observation: { synced: 0, failed: 0 },
        animal: { synced: 0, failed: 2 },
        photo: { synced: 0, failed: 0 },
        'cover-reading': { synced: 0, failed: 0 },
      },
    });
    const after = await queue.getCurrentSyncTruth();
    expect(after.lastAttemptAt).toBe(t4);
    expect(after.lastFullSuccessAt).toBe(t3);
  });

  it('multi-kind: failure in one kind blocks lastFullSuccessAt tick even if other kinds succeed', async () => {
    const { queue } = await loadQueueWithFreshFarm();
    const t = '2026-05-11T11:00:00.000Z';
    await queue.recordSyncAttempt({
      timestamp: t,
      perKindResults: {
        observation: { synced: 5, failed: 0 },
        animal: { synced: 3, failed: 0 },
        photo: { synced: 2, failed: 0 },
        'cover-reading': { synced: 0, failed: 1 }, // single failure in one kind
      },
    });
    const truth = await queue.getCurrentSyncTruth();
    expect(truth.lastAttemptAt).toBe(t);
    expect(truth.lastFullSuccessAt).toBeNull();
  });
});

describe('lib/sync/queue — SyncKind covers the four offline domain types', () => {
  it('accepts every documented kind for enqueuePending', async () => {
    const { queue } = await loadQueueWithFreshFarm();
    const kinds: SyncKind[] = ['observation', 'animal', 'photo', 'cover-reading'];
    // photo and animal need shapes appropriate to their stores; we exercise the
    // type surface here rather than the IDB payload (other suites cover that).
    expect(kinds.length).toBe(4);
    // Sanity: a queued observation shows up in the truth.
    await queue.enqueuePending('observation', makePendingObservation(42));
    const truth = await queue.getCurrentSyncTruth();
    expect(truth.pendingCount).toBeGreaterThan(0);
  });
});
