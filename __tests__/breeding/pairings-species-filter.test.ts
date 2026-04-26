/**
 * __tests__/breeding/pairings-species-filter.test.ts
 *
 * F.2 fix — suggestPairings must filter Observation rows by species.
 *
 * The `pregnancy_scan` and calving observation queries in pairings.ts
 * previously had NO species filter. On a mixed farm this produces incorrect
 * "open cow" lists (a sheep already-pregnant could appear as open cattle).
 *
 * RED test: these fail until pairings.ts adds `species` to the observation
 * WHERE clauses.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

type FullObsSeed = {
  type: string;
  animalId: string | null;
  species: string | null;
  details: string;
  observedAt: Date;
};

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

function makeAnimal(
  id: string,
  species: string,
  category: string,
  sex = 'Female',
): AnimalSeed {
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

function makeObs(
  type: string,
  animalId: string | null,
  species: string,
  details = '{}',
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

/**
 * Prisma mock that honours the `species` filter on observation queries.
 */
function makeMixedFarmPrisma(
  animals: AnimalSeed[],
  observations: FullObsSeed[],
): PrismaClient {
  return {
    animal: {
      findMany: vi.fn().mockImplementation(
        (args?: { where?: { species?: string; status?: string; id?: { in?: string[] } } }) => {
          let rows = animals;
          if (args?.where?.species) {
            rows = rows.filter((a) => a.species === args.where!.species);
          }
          if (args?.where?.id?.in) {
            const ids = new Set(args.where.id.in);
            rows = rows.filter((a) => ids.has(a.id));
          }
          return Promise.resolve(rows);
        },
      ),
    },
    observation: {
      findMany: vi.fn().mockImplementation(
        (args?: {
          where?: {
            species?: string;
            type?: string | { in?: string[] };
            animalId?: string | { in?: string[]; not?: null };
            observedAt?: { gte?: Date };
          };
        }) => {
          let rows = observations;
          // Species filter
          if (args?.where?.species !== undefined) {
            rows = rows.filter((o) => o.species === args.where!.species);
          }
          // Type filter
          const typeFilter = args?.where?.type;
          if (typeFilter) {
            if (typeof typeFilter === 'string') {
              rows = rows.filter((o) => o.type === typeFilter);
            } else if (typeFilter.in) {
              rows = rows.filter((o) => typeFilter.in!.includes(o.type));
            }
          }
          // animalId: not null filter
          if (args?.where?.animalId && typeof args.where.animalId === 'object' && 'not' in args.where.animalId) {
            if (args.where.animalId.not === null) {
              rows = rows.filter((o) => o.animalId !== null);
            }
          }
          // animalId: in filter
          if (args?.where?.animalId && typeof args.where.animalId === 'object' && 'in' in args.where.animalId) {
            const ids = new Set(args.where.animalId.in!);
            rows = rows.filter((o) => o.animalId !== null && ids.has(o.animalId!));
          }
          return Promise.resolve(rows);
        },
      ),
    },
  } as unknown as PrismaClient;
}

describe('suggestPairings — observation species filter (F.2)', () => {
  it('pregnancy_scan query is filtered by species so cattle-pregnant scan does not affect sheep pairings', async () => {
    // Setup: 10 sheep (9 ewes with pedigree + 1 ram) + 1 cattle cow with a pregnant scan
    // Without species filter, suggestPairings for sheep would see cattle's pregnant scan
    // and incorrectly exclude the ewe (if ewe animalId matched cattle scan animalId — they don't,
    // but more critically the mock can verify the species filter was passed).
    const animals: AnimalSeed[] = [
      makeAnimal('s-ram-1', 'sheep', 'Ram', 'Male'),
      ...Array.from({ length: 9 }).map((_, i) =>
        makeAnimal(`s-ewe-${i}`, 'sheep', 'Ewe', 'Female'),
      ).map((a, i) => ({ ...a, motherId: i === 0 ? 'ancestor' : null })),
      makeAnimal('c-cow-1', 'cattle', 'Cow'),
    ];

    const observations: FullObsSeed[] = [
      // Cattle pregnant scan — must NOT affect sheep pairing query
      makeObs('pregnancy_scan', 'c-cow-1', 'cattle', JSON.stringify({ result: 'pregnant' })),
    ];

    const prisma = makeMixedFarmPrisma(animals, observations);

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    // Sheep has no ewes with pedigree seed counted properly; just check the mock was called with species
    await suggestPairings(prisma, 'test-farm', 'sheep');

    const obsMock = prisma.observation.findMany as ReturnType<typeof vi.fn>;
    const calls = obsMock.mock.calls as Array<[{
      where?: { species?: string; type?: string | { in?: string[] } }
    }]>;

    // Every observation query that is for pregnancy_scan should include species="sheep"
    const pregnancyScanCalls = calls.filter((c) => {
      const t = c[0]?.where?.type;
      if (typeof t === 'string') return t === 'pregnancy_scan';
      if (t && 'in' in t) return t.in?.includes('pregnancy_scan') ?? false;
      return false;
    });

    expect(pregnancyScanCalls.length).toBeGreaterThan(0);
    const allScopedToSheep = pregnancyScanCalls.every(
      (c) => c[0]?.where?.species === 'sheep',
    );
    expect(allScopedToSheep).toBe(true);
  });

  it('calving observation query is filtered by species to avoid cross-species bull-offspring detection', async () => {
    // Without a species filter, bullCalvingObs would return cattle calving obs for a sheep run.
    // We need enough pedigree to get past the early-return gate: 20 animals, 2+ with pedigree.
    const ewes = Array.from({ length: 19 }).map((_, i) =>
      Object.assign(makeAnimal(`s-ewe-${i}`, 'sheep', 'Ewe'), {
        motherId: i < 3 ? 'ancestor' : null, // 3/20 = 15% > 10% threshold
      }),
    );
    const animals: AnimalSeed[] = [
      makeAnimal('s-ram-1', 'sheep', 'Ram', 'Male'),
      ...ewes,
    ];

    // Cattle calving obs should NOT show up in sheep pairing query
    const observations: FullObsSeed[] = [
      makeObs('calving', 'c-calf-1', 'cattle', '{}', 100),
    ];

    const prisma = makeMixedFarmPrisma(animals, observations);

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    await suggestPairings(prisma, 'test-farm', 'sheep');

    const obsMock = prisma.observation.findMany as ReturnType<typeof vi.fn>;
    const calls = obsMock.mock.calls as Array<[{
      where?: { species?: string; type?: string | { in?: string[] } }
    }]>;

    const calvingCalls = calls.filter((c) => {
      const t = c[0]?.where?.type;
      return typeof t === 'string' && t === 'calving';
    });

    expect(calvingCalls.length).toBeGreaterThan(0);
    const allScopedToSheep = calvingCalls.every(
      (c) => c[0]?.where?.species === 'sheep',
    );
    expect(allScopedToSheep).toBe(true);
  });
});
