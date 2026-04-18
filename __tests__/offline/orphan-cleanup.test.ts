// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Bug L1 — seedAnimals must prune orphan rows on full refresh.
 *
 * When an admin deletes an animal server-side, the logger PWA used to keep the
 * record indefinitely because `seedAnimals` only upserted (`put`) and never
 * deleted. The fix:
 *
 *   (a) removes any IndexedDB row whose animal_id is not in the fresh server
 *       list,
 *   (b) preserves rows whose animal_id is in the `pending_animal_updates`
 *       queue — those represent offline edits (camp-move / status-change)
 *       that have been applied locally but not yet pushed to the server,
 *   (c) early-returns on an empty `animals` payload so a transient API
 *       failure or pagination bug that returns `[]` cannot wipe the whole
 *       local cache.
 *
 * Runs in jsdom + fake-indexeddb so `idb` finds a real IndexedDB implementation.
 */

import 'fake-indexeddb/auto';

beforeEach(() => {
  vi.resetModules();
});

async function loadStore() {
  const mod = await import('@/lib/offline-store');
  // Unique DB name per test keeps each spec isolated without resetting the
  // IDB factory (which has no published type declarations).
  mod.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return mod;
}

function makeAnimal(id: string, overrides: Record<string, unknown> = {}) {
  return {
    animal_id: id,
    name: id,
    sex: 'Female',
    breed: 'Brangus',
    category: 'Cow',
    current_camp: 'camp-1',
    status: 'Active',
    date_added: '2026-01-01',
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('seedAnimals orphan cleanup', () => {
  it('removes animals that the server no longer returns', async () => {
    const { seedAnimals, getAnimalsByCampCached } = await loadStore();

    // Seed 3 animals locally.
    await seedAnimals([
      makeAnimal('A-001'),
      makeAnimal('A-002'),
      makeAnimal('A-003'),
    ]);

    const before = await getAnimalsByCampCached('camp-1');
    expect(before.map((a) => a.animal_id).sort()).toEqual([
      'A-001',
      'A-002',
      'A-003',
    ]);

    // Server now only returns 2 of them (A-003 was deleted server-side).
    await seedAnimals([makeAnimal('A-001'), makeAnimal('A-002')]);

    const after = await getAnimalsByCampCached('camp-1');
    expect(after.map((a) => a.animal_id).sort()).toEqual(['A-001', 'A-002']);
  });

  it('preserves rows whose animal_id is in the pending_animal_updates queue', async () => {
    const {
      seedAnimals,
      getAnimalsByCampCached,
      queuePendingAnimalUpdate,
    } = await loadStore();

    // A-003 has an unsynced local change — exercised via the production write
    // path (updateAnimalStatus/updateAnimalCamp both enqueue this marker).
    await seedAnimals([
      makeAnimal('A-001'),
      makeAnimal('A-002'),
      makeAnimal('A-003'),
    ]);
    await queuePendingAnimalUpdate('A-003');

    // Server returns only the two synced animals.
    await seedAnimals([makeAnimal('A-001'), makeAnimal('A-002')]);

    const after = await getAnimalsByCampCached('camp-1');
    const ids = after.map((a) => a.animal_id).sort();
    expect(ids).toEqual(['A-001', 'A-002', 'A-003']);
  });

  it('treats an empty server response as a no-op (does not wipe local rows)', async () => {
    const { seedAnimals, getAnimalsByCampCached } = await loadStore();

    await seedAnimals([
      makeAnimal('A-001'),
      makeAnimal('A-002'),
      makeAnimal('A-003'),
    ]);

    // Transient API bug / pagination glitch returns []. We must NOT delete.
    await seedAnimals([]);

    const after = await getAnimalsByCampCached('camp-1');
    expect(after.map((a) => a.animal_id).sort()).toEqual([
      'A-001',
      'A-002',
      'A-003',
    ]);
  });

  it('updateAnimalStatus auto-queues a pending marker so the row survives refresh', async () => {
    // Integration-style: exercise the production write path and prove the
    // guard actually fires. This is the class-of-bug the reviewer flagged —
    // the previous in-band `_pendingSync` flag was never set anywhere.
    const {
      seedAnimals,
      updateAnimalStatus,
      getAnimalsByCampCached,
      getPendingAnimalUpdateIds,
    } = await loadStore();

    await seedAnimals([makeAnimal('A-001'), makeAnimal('A-002')]);

    // Logger marks A-001 as Sold offline. Server hasn't seen it yet.
    await updateAnimalStatus('A-001', 'Sold');
    expect(await getPendingAnimalUpdateIds()).toEqual(['A-001']);

    // Now server responds with only A-002 (imagine A-001 was
    // coincidentally deleted server-side in the same window). The guard
    // must still preserve A-001 because its edit hasn't been pushed.
    await seedAnimals([makeAnimal('A-002')]);

    const after = await getAnimalsByCampCached('camp-1');
    const ids = after.map((a) => a.animal_id).sort();
    expect(ids).toContain('A-001');
    expect(ids).toContain('A-002');
  });
});
