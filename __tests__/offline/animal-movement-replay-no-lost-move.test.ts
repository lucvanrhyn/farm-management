// @vitest-environment jsdom
/**
 * Issue #100 — offline camp-move is NOT lost (it replays).
 *
 * Root cause (pre-fix): the logger applied the animal's `currentCamp` via a
 * `navigator.onLine` fire-and-forget `PATCH /api/animals/[id]`. Offline, that
 * PATCH never fired and there was NO replay queue for it, so the camp move was
 * silently dropped — only the `animal_movement` OBSERVATION was queued (and
 * the server never applied the move from it). On reconnect the observation
 * drained but the animal stayed in its old camp.
 *
 * The fix wires the `currentCamp` mutation onto the REPLAYED observation
 * (`POST /api/observations` → `performAnimalMove` for `type ===
 * "animal_movement"`). This test proves the queue→replay half end-to-end:
 *
 *   1. An `animal_movement` queued OFFLINE drains on `syncPendingObservations`
 *      and POSTs `/api/observations` with `details.destCampId` intact — so the
 *      server has everything it needs to advance `currentCamp`. NO lost move.
 *   2. Replaying the SAME row twice forwards the SAME `clientLocalId` both
 *      times — the server upsert (#206) collapses it to one row, and applying
 *      `currentCamp = destCampId` is naturally idempotent.
 *
 * Mirrors the queue→replay capture pattern of
 * `observation-clientlocalid-replay.test.ts` + `pending-update-drain.test.ts`.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const seenBodies: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.resetModules();
  seenBodies.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = vi.fn(
    async (url: string | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.endsWith('/api/observations') && init?.body) {
        try {
          seenBodies.push(JSON.parse(init.body as string));
        } catch {
          /* non-JSON — ignore */
        }
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: `server-${Math.random().toString(36).slice(2, 8)}` }),
        text: async () => JSON.stringify({ id: 'server-x' }),
      } as unknown as Response;
    },
  );
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

const MOVEMENT_DETAILS = JSON.stringify({
  animalId: 'BB-C014',
  sourceCampId: 'camp-source',
  destCampId: 'camp-dest',
});

describe('animal_movement offline replay — no lost move (#100)', () => {
  it('drains a queued animal_movement and POSTs destCampId so the server can advance currentCamp', async () => {
    const { store, sync } = await loadModules();

    await store.queueObservation({
      type: 'animal_movement',
      camp_id: 'camp-source',
      animal_id: 'BB-C014',
      details: MOVEMENT_DETAILS,
      created_at: '2026-05-30T10:00:00.000Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: '44444444-4444-4444-8444-444444444444',
    });

    const result = await sync.syncPendingObservations();
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);

    const obsBody = seenBodies.find((b) => b.type === 'animal_movement');
    expect(obsBody, 'expected a POST /api/observations for the movement').toBeDefined();
    // The destination camp survives the offline→replay round-trip in details,
    // so the route's performAnimalMove can advance currentCamp. THIS is the
    // no-lost-move proof: the move is carried by the replayed observation.
    expect(JSON.parse(obsBody!.details as string)).toMatchObject({
      destCampId: 'camp-dest',
    });
    expect(obsBody!.clientLocalId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('forwards the SAME clientLocalId on a replay so the move is idempotent', async () => {
    const { store, sync } = await loadModules();

    await store.queueObservation({
      type: 'animal_movement',
      camp_id: 'camp-source',
      animal_id: 'BB-C014',
      details: MOVEMENT_DETAILS,
      created_at: '2026-05-30T10:00:00.000Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: '55555555-5555-4555-8555-555555555555',
    });

    // First drain.
    await sync.syncPendingObservations();
    // Re-queue the SAME logical row (same clientLocalId) — simulates a second
    // reconnect drain of a row whose first push was not yet acked. The key is
    // replayed verbatim, so the server upsert collapses to one row and the
    // currentCamp advance is applied at most once-effectively.
    await store.queueObservation({
      type: 'animal_movement',
      camp_id: 'camp-source',
      animal_id: 'BB-C014',
      details: MOVEMENT_DETAILS,
      created_at: '2026-05-30T10:00:00.000Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: '55555555-5555-4555-8555-555555555555',
    });
    await sync.syncPendingObservations();

    const movementBodies = seenBodies.filter((b) => b.type === 'animal_movement');
    expect(movementBodies.length).toBeGreaterThanOrEqual(2);
    // Every replay carries the identical idempotency key — the server upsert
    // (#206) dedupes them and the idempotent currentCamp write never
    // double-applies.
    const keys = new Set(movementBodies.map((b) => b.clientLocalId));
    expect(keys).toEqual(new Set(['55555555-5555-4555-8555-555555555555']));
  });
});
