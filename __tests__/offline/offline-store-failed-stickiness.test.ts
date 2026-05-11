// @vitest-environment jsdom
/**
 * Issue #208 — failed rows are "sticky".
 *
 * The bug we're fixing: previously the pending pill never drained when rows
 * were failing because failed rows were re-included in the pending list (so
 * the sync loop kept retrying them and they kept failing). The N pending
 * indicator showed e.g. "3 pending" forever even after every transiently-
 * pending row had successfully synced.
 *
 * After this slice:
 *   - Failed rows stay in the failed bucket across a sync cycle (not retried
 *     automatically; that nudge arrives in #209's retry-from-UI).
 *   - Pending count drains to zero once every transient row has synced, even
 *     if failed rows exist alongside.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

async function loadStore() {
  const mod = await import('@/lib/offline-store');
  mod.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return mod;
}

describe('failed rows are sticky', () => {
  it('a failed row stays in the failed bucket after a sync cycle (not auto-retried)', async () => {
    const {
      queueObservation,
      markObservationFailed,
      getPendingObservations,
      getFailedObservations,
    } = await loadStore();

    const id = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '',
      synced_at: null,
      sync_status: 'pending',
    });
    await markObservationFailed(id, { statusCode: 422, error: 'bad payload' });

    // Simulate a sync cycle that ONLY drains pending rows — which is what the
    // updated sync-manager does. Failed rows are skipped entirely.
    const pendingForRetry = await getPendingObservations();
    expect(pendingForRetry).toHaveLength(0);

    // The failed row is still in the failed bucket — ready for the #209 UI
    // retry — and emphatically has not been auto-retried.
    const failed = await getFailedObservations();
    expect(failed).toHaveLength(1);
    expect(failed[0].local_id).toBe(id);
  });
});

describe('pending count drains to zero even when failed rows exist', () => {
  it('one pending + one failed → pendingCount === 1 after the pending row syncs', async () => {
    const {
      queueObservation,
      markObservationFailed,
      markObservationSynced,
      getPendingCount,
      getFailedCount,
    } = await loadStore();

    // 1 pending that will succeed.
    const pendingId = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '',
      synced_at: null,
      sync_status: 'pending',
    });

    // 1 pending that will fail.
    const failingId = await queueObservation({
      type: 'camp_condition',
      camp_id: 'B',
      details: '{}',
      created_at: '',
      synced_at: null,
      sync_status: 'pending',
    });
    await markObservationFailed(failingId, { statusCode: 422, error: 'no' });

    // Before sync: 1 pending, 1 failed.
    expect(await getPendingCount()).toBe(1);
    expect(await getFailedCount()).toBe(1);

    // Sync the transient row.
    await markObservationSynced(pendingId);

    // After sync: pending drained to 0, failed still 1.
    expect(await getPendingCount()).toBe(0);
    expect(await getFailedCount()).toBe(1);
  });
});
