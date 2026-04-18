// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * Bug L1 hardening — pending_animal_updates drain.
 *
 * When a pending Observation with an `animal_id` successfully pushes to the
 * server, the corresponding marker in `pending_animal_updates` must be
 * cleared. Otherwise markers accumulate forever and every subsequent orphan
 * sweep preserves ghost rows that the server has legitimately deleted.
 *
 * Symmetric to how `pending_animal_creates` entries drain via
 * markAnimalCreateSynced.
 */

import 'fake-indexeddb/auto';

beforeEach(() => {
  vi.resetModules();
  // Happy-path fetch stub: /api/observations POST returns { id: "server-…" }.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.endsWith('/api/observations')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: `server-${Math.random().toString(36).slice(2, 8)}` }),
      } as unknown as Response;
    }
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    } as unknown as Response;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadModules() {
  const store = await import('@/lib/offline-store');
  const sync = await import('@/lib/sync-manager');
  store.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return { store, sync };
}

describe('syncPendingObservations drains pending_animal_updates', () => {
  it('clears the marker for an animal whose observation successfully pushes', async () => {
    const { store, sync } = await loadModules();

    await store.queuePendingAnimalUpdate('A-001');
    await store.queueObservation({
      type: 'status_change',
      camp_id: 'camp-1',
      animal_id: 'A-001',
      details: '{}',
      created_at: '2026-04-18T09:00:00Z',
      synced_at: null,
      sync_status: 'pending',
    });

    expect(await store.getPendingAnimalUpdateIds()).toEqual(['A-001']);

    const result = await sync.syncPendingObservations();
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);

    // Marker is gone — server has applied the mutation, orphan sweep is free
    // to operate on this animal_id again.
    expect(await store.getPendingAnimalUpdateIds()).toEqual([]);
  });

  it('keeps the marker when the observation push fails', async () => {
    const { store, sync } = await loadModules();

    // Force the fetch stub into failure mode for this test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    }));

    await store.queuePendingAnimalUpdate('A-002');
    await store.queueObservation({
      type: 'camp_move',
      camp_id: 'camp-2',
      animal_id: 'A-002',
      details: '{}',
      created_at: '2026-04-18T09:00:00Z',
      synced_at: null,
      sync_status: 'pending',
    });

    const result = await sync.syncPendingObservations();
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);

    // Marker is preserved so the next orphan sweep still protects the row.
    expect(await store.getPendingAnimalUpdateIds()).toEqual(['A-002']);
  });

  it('does not touch the marker set for farm-wide observations (no animal_id)', async () => {
    const { store, sync } = await loadModules();

    await store.queuePendingAnimalUpdate('A-003');
    await store.queueObservation({
      type: 'rainfall',
      camp_id: 'camp-3',
      details: '{"mm":12}',
      created_at: '2026-04-18T09:00:00Z',
      synced_at: null,
      sync_status: 'pending',
    });

    const result = await sync.syncPendingObservations();
    expect(result.synced).toBe(1);

    // Marker for A-003 must remain — the rainfall observation is unrelated.
    expect(await store.getPendingAnimalUpdateIds()).toEqual(['A-003']);
  });
});
