// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Bug L1 — seedAnimals must prune orphan rows on full refresh.
 *
 * When an admin deletes an animal server-side, the logger PWA used to keep the
 * record indefinitely because `seedAnimals` only upserted (`put`) and never
 * deleted. This suite drives a TDD fix that (a) removes any IndexedDB row whose
 * animal_id is not in the fresh server list, while (b) preserving rows that
 * carry a pending local mutation so we never silently lose offline-queued work.
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

  it('preserves rows with a pending local mutation even when server omits them', async () => {
    const { seedAnimals, getAnimalsByCampCached } = await loadStore();

    // A-003 has an unsynced local change (e.g. logger edited status offline).
    await seedAnimals([
      makeAnimal('A-001'),
      makeAnimal('A-002'),
      makeAnimal('A-003', { _pendingSync: true }),
    ]);

    // Server returns only the two synced animals.
    await seedAnimals([makeAnimal('A-001'), makeAnimal('A-002')]);

    const after = await getAnimalsByCampCached('camp-1');
    const ids = after.map((a) => a.animal_id).sort();
    expect(ids).toEqual(['A-001', 'A-002', 'A-003']);

    // Pending flag survives so the next sync push still fires.
    const pending = after.find((a) => a.animal_id === 'A-003');
    expect((pending as { _pendingSync?: boolean })._pendingSync).toBe(true);
  });
});
