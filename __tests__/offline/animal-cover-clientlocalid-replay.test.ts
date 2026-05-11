// @vitest-environment jsdom
/**
 * Issue #207 — Cycle 3: sync-replay preserves the client UUID for
 * Animal + CampCoverReading.
 *
 * Mirrors `__tests__/offline/observation-clientlocalid-replay.test.ts`
 * (#206) one-for-one against the Animal + Cover replay paths.
 *
 * Without this contract, Cycle 1's server-side `upsert` and Cycle 2's
 * mount-stable UUID are both wasted: if the offline queue regenerated the
 * UUID on replay (or simply dropped the field on the POST body), every
 * retry would arrive at /api/animals (or /cover) as a fresh idempotency
 * key and the server would create a new row anyway.
 *
 * This file pins:
 *   1. `syncPendingAnimals` POSTs `/api/animals` with the queued
 *      `clientLocalId` verbatim — no regeneration, no stripping.
 *   2. `syncPendingCoverReadings` POSTs the cover route with the queued
 *      `clientLocalId` verbatim — same contract.
 *
 * The end-to-end "one row after retry" invariant is asserted separately in
 * Cycle 4 (animal-idempotency-e2e.test.ts, cover-idempotency-e2e.test.ts).
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setupFreshFarm() {
  const mod = await import('@/lib/offline-store');
  mod.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return mod;
}

describe('syncPendingAnimals — POST body preserves clientLocalId (#207)', () => {
  it('forwards clientLocalId on the request body verbatim — no regeneration', async () => {
    const store = await setupFreshFarm();
    const uuid = 'a1111111-1111-4111-8111-111111111111';

    await store.queueAnimalCreate({
      animal_id: 'A-001',
      sex: 'Female',
      category: 'Calf',
      current_camp: 'A',
      date_added: '2026-05-11',
      sync_status: 'pending',
      clientLocalId: uuid,
    });

    const seenBodies: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body) {
          try {
            seenBodies.push(JSON.parse(init.body as string));
          } catch {
            seenBodies.push(init.body);
          }
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      },
    );

    const { syncPendingAnimals } = await import('@/lib/sync-manager');
    const result = await syncPendingAnimals();
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);

    const animalBody = seenBodies.find(
      (b): b is { clientLocalId: string; animalId: string } =>
        typeof b === 'object' &&
        b !== null &&
        'animalId' in b &&
        (b as { animalId: unknown }).animalId === 'A-001',
    );
    expect(animalBody, 'expected a POST /api/animals body').toBeDefined();
    expect(
      animalBody!.clientLocalId,
      'sync-manager must forward the queued clientLocalId on the /api/animals POST body',
    ).toBe(uuid);
  });
});

describe('syncPendingCoverReadings — POST body preserves clientLocalId (#207)', () => {
  it('forwards clientLocalId on the request body verbatim — no regeneration', async () => {
    const store = await setupFreshFarm();
    const uuid = 'c1111111-1111-4111-8111-111111111111';

    await store.queueCoverReading({
      farm_slug: 'test-farm',
      camp_id: 'A',
      cover_category: 'Good',
      created_at: '2026-05-11T10:00:00.000Z',
      sync_status: 'pending',
      clientLocalId: uuid,
    });

    const seenBodies: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        let body: unknown = null;
        if (init?.body) {
          try {
            body = JSON.parse(init.body as string);
          } catch {
            body = init.body;
          }
        }
        seenBodies.push({ url, body });
        return new Response(
          JSON.stringify({ reading: { id: 'srv-1' } }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      },
    );

    const { syncPendingCoverReadings } = await import('@/lib/sync-manager');
    const result = await syncPendingCoverReadings();
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);

    const coverPost = seenBodies.find(
      (entry) =>
        entry.url.includes('/cover') &&
        typeof entry.body === 'object' &&
        entry.body !== null &&
        'coverCategory' in (entry.body as Record<string, unknown>),
    );
    expect(coverPost, 'expected a POST /cover body').toBeDefined();
    expect(
      (coverPost!.body as { clientLocalId?: string }).clientLocalId,
      'sync-manager must forward the queued clientLocalId on the /cover POST body',
    ).toBe(uuid);
  });
});
