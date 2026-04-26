/**
 * __tests__/breeding/snapshot-species-filter.test.ts
 *
 * F.2 fix — getBreedingSnapshot must filter Observation rows by species.
 *
 * On a mixed-species farm (cattle + sheep) the `pregnancy_scan` and
 * `insemination` observation queries previously had NO species filter,
 * so calling with species="sheep" would pull in cattle scan results and
 * produce wrong KPIs.
 *
 * RED test: these fail until snapshot.ts adds `species` to the
 * observation WHERE clauses.
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
};

type ObsSeed = {
  animalId: string;
  details: string;
  observedAt: Date;
  species: string | null;
};

const PREGNANT_DETAILS = JSON.stringify({ result: 'pregnant' });

/**
 * Prisma mock that honours the `species` filter on observation queries.
 * All observation rows carry an explicit `species` field so the test
 * can assert the filter is applied.
 */
function makeMixedFarmPrisma(
  animals: AnimalSeed[],
  observations: ObsSeed[],
): PrismaClient {
  return {
    animal: {
      findMany: vi.fn().mockImplementation(
        (args?: { where?: { species?: string; status?: string } }) => {
          const sp = args?.where?.species;
          if (!sp) return Promise.resolve(animals);
          return Promise.resolve(animals.filter((a) => (a as AnimalSeed & { species?: string }).species === sp));
        },
      ),
    },
    observation: {
      findMany: vi.fn().mockImplementation(
        (args?: { where?: { species?: string; type?: string | { in?: string[] } } }) => {
          let rows = observations;
          // Filter by species if the caller passed one
          if (args?.where?.species !== undefined) {
            const sp = args.where.species;
            rows = rows.filter((o) => o.species === sp);
          }
          // Filter by type
          const typeFilter = args?.where?.type;
          if (typeFilter) {
            if (typeof typeFilter === 'string') {
              rows = rows.filter((o) => {
                // We need type on ObsSeed too for this check; cast as any
                return (o as { type?: string }).type === typeFilter;
              });
            } else if (typeFilter.in) {
              rows = rows.filter((o) => {
                return typeFilter.in!.includes((o as { type?: string }).type ?? '');
              });
            }
          }
          return Promise.resolve(rows);
        },
      ),
    },
  } as unknown as PrismaClient;
}

type FullObsSeed = ObsSeed & { type: string };

function makeObs(
  type: string,
  animalId: string,
  species: string,
  details = PREGNANT_DETAILS,
  daysAgo = 30,
): FullObsSeed {
  return {
    type,
    animalId,
    species,
    details,
    observedAt: new Date(Date.now() - daysAgo * 86_400_000),
  };
}

function makeAnimal(
  id: string,
  species: string,
  category: string,
  sex = 'Female',
): AnimalSeed & { species: string } {
  return {
    id,
    animalId: id,
    sex,
    category,
    status: 'Active',
    motherId: null,
    fatherId: null,
    species,
  };
}

describe('getBreedingSnapshot — observation species filter (F.2)', () => {
  it('filters pregnancy_scan observations by species: sheep scan does NOT appear in cattle snapshot', async () => {
    // Farm has: 1 cattle cow + 1 sheep ewe, each with a "pregnant" scan
    const animals = [
      makeAnimal('c-bull-1', 'cattle', 'Bull', 'Male'),
      makeAnimal('c-cow-1', 'cattle', 'Cow'),
      makeAnimal('s-ram-1', 'sheep', 'Ram', 'Male'),
      makeAnimal('s-ewe-1', 'sheep', 'Ewe'),
    ];

    const observations: FullObsSeed[] = [
      makeObs('pregnancy_scan', 'c-cow-1', 'cattle', PREGNANT_DETAILS),
      makeObs('pregnancy_scan', 's-ewe-1', 'sheep', PREGNANT_DETAILS), // must NOT be counted in cattle snapshot
    ];

    const prisma = makeMixedFarmPrisma(animals, observations);

    const { getBreedingSnapshot } = await import('@/lib/server/breeding-analytics');
    const snap = await getBreedingSnapshot(prisma, 'test-farm', 'cattle');

    // The observation mock filters by species — if snapshot.ts passes species
    // to the query, it gets 1 cattle scan → 1 pregnant cow.
    // If snapshot.ts does NOT pass species, it gets 2 scans → 2 pregnant (wrong).
    expect(snap.pregnantCows).toBe(1);

    // Verify the mock WAS called with a species filter
    const obsMock = (prisma.observation.findMany as ReturnType<typeof vi.fn>);
    const calls = obsMock.mock.calls as Array<[{ where?: { species?: string } }]>;
    const someCallHasSpecies = calls.some((c) => c[0]?.where?.species === 'cattle');
    expect(someCallHasSpecies).toBe(true);
  });

  it('filters pregnancy_scan observations by species: cattle scan does NOT appear in sheep snapshot', async () => {
    const animals = [
      makeAnimal('s-ram-1', 'sheep', 'Ram', 'Male'),
      makeAnimal('s-ewe-1', 'sheep', 'Ewe'),
      makeAnimal('s-ewe-2', 'sheep', 'Ewe'),
      makeAnimal('c-cow-1', 'cattle', 'Cow'),
    ];

    const observations: FullObsSeed[] = [
      makeObs('pregnancy_scan', 'c-cow-1', 'cattle', PREGNANT_DETAILS), // must NOT appear in sheep snapshot
      makeObs('pregnancy_scan', 's-ewe-1', 'sheep', PREGNANT_DETAILS),
    ];

    const prisma = makeMixedFarmPrisma(animals, observations);

    const { getBreedingSnapshot } = await import('@/lib/server/breeding-analytics');
    const snap = await getBreedingSnapshot(prisma, 'test-farm', 'sheep');

    // Only s-ewe-1 is pregnant; s-ewe-2 is open. 1 pregnant, 1 open.
    expect(snap.pregnantCows).toBe(1);
    expect(snap.openCows).toBe(1);
  });

  it('filters insemination observations by species on a mixed farm', async () => {
    // ewe-1 has an insemination (sheep); c-cow-1 has an insemination (cattle)
    // Requesting sheep snapshot must NOT include c-cow-1 insemination in calendarEntries
    const animals = [
      makeAnimal('s-ram-1', 'sheep', 'Ram', 'Male'),
      makeAnimal('s-ewe-1', 'sheep', 'Ewe'),
      makeAnimal('c-bull-1', 'cattle', 'Bull', 'Male'),
      makeAnimal('c-cow-1', 'cattle', 'Cow'),
    ];

    // Recent inseminations (within 90 days) for both species
    const observations: FullObsSeed[] = [
      makeObs('insemination', 'c-cow-1', 'cattle', '{}', 10),
      makeObs('insemination', 's-ewe-1', 'sheep', '{}', 10),
    ];

    const prisma = makeMixedFarmPrisma(animals, observations);

    const { getBreedingSnapshot } = await import('@/lib/server/breeding-analytics');
    await getBreedingSnapshot(prisma, 'test-farm', 'sheep');

    // s-ewe-1 insem → 1 calendar candidate; c-cow-1 must be excluded
    // (calendar requires expectedDate within 60 days — 10 day old insem + 150d gestation = 140 days out → filtered from calendarEntries)
    // But the key check: insem mock was filtered by species
    const obsMock = (prisma.observation.findMany as ReturnType<typeof vi.fn>);
    const calls = obsMock.mock.calls as Array<[{ where?: { species?: string; type?: string } }]>;
    const insemCalls = calls.filter((c) => c[0]?.where?.type === 'insemination');
    const sheepInsemCall = insemCalls.some((c) => c[0]?.where?.species === 'sheep');
    expect(sheepInsemCall).toBe(true);
  });
});
