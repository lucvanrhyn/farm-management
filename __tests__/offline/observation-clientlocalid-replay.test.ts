// @vitest-environment jsdom
/**
 * Issue #206 — Cycle 3: sync-replay preserves the client UUID.
 *
 * Without this contract, Cycle 1's server-side `upsert` and Cycle 2's
 * mount-stable UUID are both wasted: if the offline queue regenerated the
 * UUID on replay (or simply dropped the field on the POST body), every
 * retry would arrive at /api/observations as a fresh idempotency key and
 * the server would create a new row anyway.
 *
 * This file pins two halves of that pipeline:
 *
 *   1. `PendingObservation` (lib/offline-store) ACCEPTS and PERSISTS a
 *      `clientLocalId` field. `getPendingObservations` returns it intact.
 *
 *   2. `syncPendingObservations` (lib/sync-manager) POSTs the request body
 *      with the EXACT same `clientLocalId` it read from IDB — no
 *      regeneration, no stripping.
 *
 * The end-to-end "one row after retry" invariant is asserted separately in
 * Cycle 4 (observation-idempotency-e2e.test.ts).
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadStore() {
  const mod = await import('@/lib/offline-store');
  mod.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return mod;
}

describe('PendingObservation persistence — clientLocalId (#206)', () => {
  it('queueObservation stores clientLocalId and getPendingObservations returns it intact', async () => {
    const { queueObservation, getPendingObservations } = await loadStore();
    const uuid = '66666666-6666-4666-8666-666666666666';

    await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: JSON.stringify({ grazing: 'Good' }),
      created_at: '2026-05-11T10:00:00.000Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: uuid,
    });

    const pending = await getPendingObservations();
    expect(pending).toHaveLength(1);
    expect(
      pending[0].clientLocalId,
      'IDB round-trip must preserve clientLocalId',
    ).toBe(uuid);
  });
});

describe('syncPendingObservations — POST body preserves clientLocalId (#206)', () => {
  it('forwards clientLocalId on the request body verbatim — no regeneration', async () => {
    const { queueObservation, setActiveFarmSlug } = await import(
      '@/lib/offline-store'
    );
    setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
    const uuid = '77777777-7777-4777-8777-777777777777';

    await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-11T10:00:00.000Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: uuid,
    });

    // Capture every POST body for inspection.
    const seenBodies: unknown[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.body) {
            try {
              seenBodies.push(JSON.parse(init.body as string));
            } catch {
              seenBodies.push(init.body);
            }
          }
          return new Response(JSON.stringify({ id: 'srv-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      );

    const { syncPendingObservations } = await import('@/lib/sync-manager');
    const result = await syncPendingObservations();

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(fetchSpy).toHaveBeenCalled();

    // Find the /api/observations POST among the captured bodies.
    const obsBody = seenBodies.find(
      (b): b is { clientLocalId: string } =>
        typeof b === 'object' &&
        b !== null &&
        'type' in b &&
        (b as { type: unknown }).type === 'camp_condition',
    );
    expect(obsBody, 'expected one POST /api/observations body').toBeDefined();
    expect(
      obsBody!.clientLocalId,
      'sync-manager must forward the queued clientLocalId on the POST body — regenerating it would defeat server-side idempotency',
    ).toBe(uuid);
  });
});
