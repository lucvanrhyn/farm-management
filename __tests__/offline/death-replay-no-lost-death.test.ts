// @vitest-environment jsdom
/**
 * Issue #538 — offline `death` status is NOT lost (it replays). The
 * higher-stakes twin of #100 (offline camp-move).
 *
 * Root cause (pre-fix): the logger applied the animal's `status = "Deceased"`
 * (+ `deceasedAt`) via a `navigator.onLine` fire-and-forget
 * `PATCH /api/animals/[id]`. Offline, that PATCH never fired and there was NO
 * replay queue for it, so the death status was silently dropped — only the
 * `death` OBSERVATION was queued (and the server never applied the status from
 * it). On reconnect the observation drained but the animal stayed Active.
 *
 * The fix wires the status mutation onto the REPLAYED observation
 * (`POST /api/observations` → `performAnimalDeath` for `type === "death"`).
 * This test proves the queue→replay half end-to-end:
 *
 *   1. A `death` queued OFFLINE drains on `syncPendingObservations` and POSTs
 *      `/api/observations` with `animal_id` + `created_at` intact — so the
 *      server has everything it needs to mark the animal Deceased (and anchor
 *      deceasedAt). NO lost death.
 *   2. Replaying the SAME row twice forwards the SAME `clientLocalId` both
 *      times — the server upsert (#206) collapses it to one row, and applying
 *      `status = "Deceased"` with the same `deceasedAt` is naturally idempotent.
 *
 * Mirrors the queue→replay capture pattern of
 * `animal-movement-replay-no-lost-move.test.ts` (#100).
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

const DEATH_DETAILS = JSON.stringify({
  cause: 'Disease',
  carcassDisposal: 'BURIED',
});

describe('death offline replay — no lost death (#538)', () => {
  it('drains a queued death and POSTs animal_id + timestamp so the server can mark it Deceased', async () => {
    const { store, sync } = await loadModules();

    await store.queueObservation({
      type: 'death',
      camp_id: 'camp-source',
      animal_id: 'BB-C014',
      details: DEATH_DETAILS,
      created_at: '2026-05-30T10:00:00.000Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: '44444444-4444-4444-8444-444444444444',
    });

    const result = await sync.syncPendingObservations();
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);

    const obsBody = seenBodies.find((b) => b.type === 'death');
    expect(obsBody, 'expected a POST /api/observations for the death').toBeDefined();
    // The animal tag + recording timestamp survive the offline→replay
    // round-trip, so the route's performAnimalDeath can set status=Deceased
    // (anchoring deceasedAt to created_at). THIS is the no-lost-death proof:
    // the status change is carried by the replayed observation.
    expect(obsBody!.animal_id).toBe('BB-C014');
    expect(obsBody!.created_at).toBe('2026-05-30T10:00:00.000Z');
    expect(obsBody!.clientLocalId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('forwards the SAME clientLocalId on a replay so the death is idempotent', async () => {
    const { store, sync } = await loadModules();

    await store.queueObservation({
      type: 'death',
      camp_id: 'camp-source',
      animal_id: 'BB-C014',
      details: DEATH_DETAILS,
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
    // status advance is applied at most once-effectively (same deceasedAt).
    await store.queueObservation({
      type: 'death',
      camp_id: 'camp-source',
      animal_id: 'BB-C014',
      details: DEATH_DETAILS,
      created_at: '2026-05-30T10:00:00.000Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: '55555555-5555-4555-8555-555555555555',
    });
    await sync.syncPendingObservations();

    const deathBodies = seenBodies.filter((b) => b.type === 'death');
    expect(deathBodies.length).toBeGreaterThanOrEqual(2);
    // Every replay carries the identical idempotency key — the server upsert
    // (#206) dedupes them and the idempotent status write never double-applies
    // a divergent deceasedAt.
    const keys = new Set(deathBodies.map((b) => b.clientLocalId));
    expect(keys).toEqual(new Set(['55555555-5555-4555-8555-555555555555']));
  });
});
