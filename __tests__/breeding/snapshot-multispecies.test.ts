/**
 * __tests__/breeding/snapshot-multispecies.test.ts
 *
 * Phase F — getBreedingSnapshot is now species-aware.
 *
 * - signature stays backwards compatible: `getBreedingSnapshot(prisma, farmSlug)`
 *   defaults to cattle (regression-safe).
 * - new optional 3rd arg `species` switches the Prisma filter, gestation
 *   period, and returned KPI fields.
 * - all numeric fields are valid numbers for every species — never NaN, never
 *   null where a number is expected.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

type AnimalSeed = {
  id: string;
  animalId: string;
  sex: string;
  category: string;
  status: string;
  motherId: string | null;
  fatherId: string | null;
  species: string;
};

function makePrisma(animalsBySpecies: Record<string, AnimalSeed[]>): PrismaClient {
  const findManyAnimal = vi.fn().mockImplementation((args?: { where?: { species?: string } }) => {
    const filterSpecies = args?.where?.species;
    if (!filterSpecies) {
      return Promise.resolve(Object.values(animalsBySpecies).flat());
    }
    return Promise.resolve(animalsBySpecies[filterSpecies] ?? []);
  });
  return {
    animal: { findMany: findManyAnimal },
    observation: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
}

function seed(o: Partial<AnimalSeed> & { id: string; species: string }): AnimalSeed {
  return {
    animalId: o.id,
    sex: 'Female',
    category: 'Cow',
    status: 'Active',
    motherId: null,
    fatherId: null,
    ...o,
  };
}

describe('getBreedingSnapshot — multi-species', () => {
  it('default (no species arg) returns cattle snapshot — backwards compatible', async () => {
    const prisma = makePrisma({
      cattle: [
        seed({ id: 'c-bull-1', species: 'cattle', sex: 'Male', category: 'Bull' }),
        seed({ id: 'c-cow-1', species: 'cattle', sex: 'Female', category: 'Cow' }),
      ],
      sheep: [
        seed({ id: 's-ram-1', species: 'sheep', sex: 'Male', category: 'Ram' }),
      ],
    });

    const { getBreedingSnapshot } = await import('@/lib/server/breeding-analytics');
    const snap = await getBreedingSnapshot(prisma, 'test-farm');

    // Cattle-only — sheep are filtered out
    expect(snap.bullsInService).toBe(1);
    expect(snap.openCows).toBe(1);
  });

  it('species="sheep" returns sheep snapshot with rams + ewes (no NaN)', async () => {
    const prisma = makePrisma({
      sheep: [
        seed({ id: 's-ram-1', species: 'sheep', sex: 'Male', category: 'Ram' }),
        seed({ id: 's-ewe-1', species: 'sheep', sex: 'Female', category: 'Ewe' }),
        seed({ id: 's-ewe-2', species: 'sheep', sex: 'Female', category: 'Ewe' }),
        seed({ id: 's-mewe-1', species: 'sheep', sex: 'Female', category: 'Maiden Ewe' }),
      ],
    });

    const { getBreedingSnapshot } = await import('@/lib/server/breeding-analytics');
    const snap = await getBreedingSnapshot(prisma, 'test-farm', 'sheep');

    // Same shape as cattle — `bullsInService` becomes "rams in service" semantically
    expect(snap.bullsInService).toBe(1); // 1 ram
    expect(snap.openCows).toBe(3); // 2 ewes + 1 maiden ewe (all open since no scans)
    expect(snap.pregnantCows).toBe(0);
    expect(Number.isFinite(snap.expectedCalvingsThisMonth)).toBe(true);
    expect(snap.expectedCalvingsThisMonth).toBe(0);
    expect(snap.calendarEntries).toEqual([]);
  });

  it('species="game" returns game snapshot using Adult Male / Adult Female categories', async () => {
    const prisma = makePrisma({
      game: [
        seed({ id: 'g-male-1', species: 'game', sex: 'Male', category: 'Adult Male' }),
        seed({ id: 'g-female-1', species: 'game', sex: 'Female', category: 'Adult Female' }),
        seed({ id: 'g-female-2', species: 'game', sex: 'Female', category: 'Adult Female' }),
        seed({ id: 'g-sub-1', species: 'game', sex: 'Female', category: 'Sub-adult' }),
      ],
    });

    const { getBreedingSnapshot } = await import('@/lib/server/breeding-analytics');
    const snap = await getBreedingSnapshot(prisma, 'test-farm', 'game');

    expect(snap.bullsInService).toBe(1); // 1 adult male
    expect(snap.openCows).toBe(3); // 2 adult females + 1 sub-adult female
    expect(snap.pregnantCows).toBe(0);
    expect(Number.isFinite(snap.expectedCalvingsThisMonth)).toBe(true);
  });

  it('species="llama" throws UnknownBreedingSpeciesError (no silent fallback)', async () => {
    const prisma = makePrisma({});

    const { getBreedingSnapshot } = await import('@/lib/server/breeding-analytics');
    const { UnknownBreedingSpeciesError } = await import('@/lib/species/breeding-constants');

    await expect(
      getBreedingSnapshot(prisma, 'test-farm', 'llama' as never),
    ).rejects.toThrow(UnknownBreedingSpeciesError);
  });
});
