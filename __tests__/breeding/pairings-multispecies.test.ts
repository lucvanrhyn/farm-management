/**
 * __tests__/breeding/pairings-multispecies.test.ts
 *
 * Phase F — suggestPairings is now species-aware.
 * Default behavior (no species arg) keeps cattle semantics for backwards
 * compat; explicit "sheep" / "game" routes through the per-species
 * categories and gestation period.
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
  return {
    animal: {
      findMany: vi.fn().mockImplementation((args?: { where?: { species?: string } }) => {
        const f = args?.where?.species;
        return Promise.resolve(f ? (animalsBySpecies[f] ?? []) : Object.values(animalsBySpecies).flat());
      }),
    },
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

describe('suggestPairings — multi-species', () => {
  it('species="sheep" returns NO_BULLS when sheep herd has no rams (categories routed correctly)', async () => {
    const prisma = makePrisma({
      sheep: [
        // 10 ewes, no rams → NO_BULLS for the sheep flow
        ...Array.from({ length: 10 }).map((_, i) =>
          seed({
            id: `ewe-${i}`,
            species: 'sheep',
            sex: 'Female',
            category: 'Ewe',
            // 10% pedigree seed satisfied
            motherId: i === 0 ? 'old-ewe' : null,
          }),
        ),
      ],
    });

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm', 'sheep');

    expect(result.pairings).toEqual([]);
    expect(result.reason).toBe('NO_BULLS');
  });

  it('species="game" returns NO_BULLS when no Adult Males in herd', async () => {
    const prisma = makePrisma({
      game: [
        ...Array.from({ length: 10 }).map((_, i) =>
          seed({
            id: `f-${i}`,
            species: 'game',
            sex: 'Female',
            category: 'Adult Female',
            motherId: i === 0 ? 'ancestor' : null,
          }),
        ),
      ],
    });

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm', 'game');

    expect(result.pairings).toEqual([]);
    expect(result.reason).toBe('NO_BULLS');
  });

  it('species="llama" throws typed error (no silent fallback to cattle)', async () => {
    const prisma = makePrisma({});

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const { UnknownBreedingSpeciesError } = await import('@/lib/species/breeding-constants');

    await expect(
      suggestPairings(prisma, 'test-farm', 'llama' as never),
    ).rejects.toThrow(UnknownBreedingSpeciesError);
  });

  it('default (no species arg) preserves cattle behavior — regression-safe', async () => {
    // Same scenario as legacy test: empty herd → NO_PEDIGREE_SEED
    const prisma = makePrisma({});

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm');

    expect(result.pairings).toEqual([]);
    expect(result.reason).toBe('NO_PEDIGREE_SEED');
  });
});
