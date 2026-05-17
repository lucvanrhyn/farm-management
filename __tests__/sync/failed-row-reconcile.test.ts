// @vitest-environment jsdom
/**
 * Issue #287 — failed-row sync reconciliation.
 *
 * Root cause being pinned:
 *   Issue #208 made failed rows strict — they leave the pending bucket and
 *   are never auto-retried. There was no mechanism to notice that a failed
 *   row's record actually DID reach the server (the idempotent
 *   `clientLocalId` upsert from #281, or a transient failure where the POST
 *   landed but the response was lost). So the Logger "Failed: N" indicator
 *   stayed stuck forever even though the data was safely server-side.
 *
 * Contract pinned here:
 *   - After a sync cycle, `reconcileFailedRows()` cross-references every
 *     IDB observation row still in `failed` state against the server's
 *     queue-status mirror (`GET /api/sync/queue/status`). Any failed row
 *     whose `clientLocalId` is server-confirmed flips to `synced`.
 *   - A failed row whose `clientLocalId` is NOT in the server mirror stays
 *     `failed` (ADR-0002: only a confirmed server mirror may flip
 *     failed→synced; a row the server has never seen must not be cleared).
 *   - `syncAndRefresh` invokes the reconcile pass at the end of the cycle,
 *     so `getCurrentSyncTruth().failedCount` returns to 0 once the queued
 *     records are confirmed (acceptance #1–#4).
 *   - The pass is idempotent: a second run does not double-count or error.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadStore() {
  const mod = await import('@/lib/offline-store');
  mod.setActiveFarmSlug(`recon-${Math.random().toString(36).slice(2)}`);
  return mod;
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Mock fetch: the queue-status mirror confirms the given clientLocalIds;
 * every other endpoint returns a benign 200 so the cache pull in
 * `syncAndRefresh` doesn't throw.
 */
function mockFetch(confirmedClientLocalIds: string[]) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/sync/queue/status')) {
      return jsonOk({
        receivedAt: new Date().toISOString(),
        observations: confirmedClientLocalIds.map((cid, i) => ({
          id: `srv-${i}`,
          clientLocalId: cid,
          type: 'health_issue',
          animalId: null,
          campId: 'camp-1',
          createdAt: new Date().toISOString(),
        })),
      });
    }
    if (url.includes('/api/camps')) return jsonOk([]);
    if (url.includes('/api/animals')) return jsonOk({ items: [], nextCursor: null, hasMore: false });
    if (url.includes('/api/farm')) return jsonOk({ farmName: 'F', breed: 'B' });
    return jsonOk({});
  }) as typeof fetch;
}

describe('reconcileFailedRows — failed→synced when server-confirmed (#287)', () => {
  it('flips a stuck failed observation to synced when its clientLocalId is server-confirmed', async () => {
    const store = await loadStore();
    const { reconcileFailedRows } = await import('@/lib/sync-manager');

    const clientLocalId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const id = await store.queueObservation({
      type: 'health_issue',
      camp_id: 'camp-1',
      details: '{}',
      created_at: '2026-05-17T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId,
    });
    // Simulate the stuck state: a transient failure left the row in `failed`.
    await store.markObservationFailed(id, { statusCode: 500, error: 'transient' });
    expect((await store.getFailedObservations()).length).toBe(1);

    mockFetch([clientLocalId]);
    await reconcileFailedRows();

    const failedAfter = await store.getFailedObservations();
    expect(failedAfter.length).toBe(0);
    expect(await store.getFailedObservationsCount()).toBe(0);
  });

  it('leaves a failed row failed when its clientLocalId is NOT server-confirmed (ADR-0002)', async () => {
    const store = await loadStore();
    const { reconcileFailedRows } = await import('@/lib/sync-manager');

    const id = await store.queueObservation({
      type: 'health_issue',
      camp_id: 'camp-1',
      details: '{}',
      created_at: '2026-05-17T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: 'never-on-server-uuid',
    });
    await store.markObservationFailed(id, { statusCode: 422, error: 'bad payload' });

    mockFetch(['some-other-confirmed-uuid']);
    await reconcileFailedRows();

    expect((await store.getFailedObservations()).length).toBe(1);
    expect(await store.getFailedObservationsCount()).toBe(1);
  });

  it('is idempotent — a second reconcile does not error or double-count', async () => {
    const store = await loadStore();
    const { reconcileFailedRows } = await import('@/lib/sync-manager');

    const clientLocalId = '11111111-2222-4333-8444-555555555555';
    const id = await store.queueObservation({
      type: 'health_issue',
      camp_id: 'camp-1',
      details: '{}',
      created_at: '2026-05-17T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId,
    });
    await store.markObservationFailed(id, { statusCode: 500, error: 'transient' });

    mockFetch([clientLocalId]);
    await reconcileFailedRows();
    await reconcileFailedRows();

    expect(await store.getFailedObservationsCount()).toBe(0);
  });

  it('skips failed rows with no clientLocalId (cannot be safely matched)', async () => {
    const store = await loadStore();
    const { reconcileFailedRows } = await import('@/lib/sync-manager');

    const id = await store.queueObservation({
      type: 'health_issue',
      camp_id: 'camp-1',
      details: '{}',
      created_at: '2026-05-17T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
      // no clientLocalId — legacy row
    });
    await store.markObservationFailed(id, { statusCode: 500, error: 'transient' });

    mockFetch([]);
    await reconcileFailedRows();

    expect(await store.getFailedObservationsCount()).toBe(1);
  });
});

describe('syncAndRefresh — reconcile pass clears stuck Failed: N (#287 acceptance #4)', () => {
  it('a stuck failed row whose record exists server-side reconciles and the count returns to 0', async () => {
    const store = await loadStore();
    const { syncAndRefresh } = await import('@/lib/sync-manager');
    const { getCurrentSyncTruth } = await import('@/lib/sync/queue');

    const clientLocalId = '99999999-8888-4777-8666-555555555555';
    const id = await store.queueObservation({
      type: 'health_issue',
      camp_id: 'camp-1',
      details: '{}',
      created_at: '2026-05-17T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId,
    });
    // Stuck failed BEFORE the cycle (a previous cycle's transient 500 that
    // actually landed server-side via the #281 idempotent upsert).
    await store.markObservationFailed(id, { statusCode: 500, error: 'transient' });
    expect((await getCurrentSyncTruth()).failedCount).toBe(1);

    // The server mirror confirms the record exists.
    mockFetch([clientLocalId]);
    await syncAndRefresh();

    expect((await getCurrentSyncTruth()).failedCount).toBe(0);
  });
});
