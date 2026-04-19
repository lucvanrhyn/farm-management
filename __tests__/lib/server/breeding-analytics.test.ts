/**
 * __tests__/lib/server/breeding-analytics.test.ts
 *
 * Focused tests for suggestPairings() empty-state handling.
 *
 * The old implementation returned PairingSuggestion[]; with zero pedigree
 * data every COI was 0 and the page got a 33,656-row cartesian product of
 * junk. This test suite locks in the new NO_PEDIGREE_SEED envelope so the
 * regression can't sneak back.
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

function makeMockPrisma(animals: AnimalSeed[]): PrismaClient {
  return {
    animal: {
      findMany: vi.fn().mockResolvedValue(animals),
    },
    observation: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient;
}

function seedAnimal(overrides: Partial<AnimalSeed> & { id: string }): AnimalSeed {
  return {
    animalId: overrides.id,
    sex: 'Female',
    category: 'Cow',
    status: 'Active',
    motherId: null,
    fatherId: null,
    ...overrides,
  };
}

describe('suggestPairings — empty-state reasons', () => {
  it('returns NO_PEDIGREE_SEED when farm has animals but no fatherId/motherId anywhere', async () => {
    const animals: AnimalSeed[] = [
      seedAnimal({ id: 'bull-1', sex: 'Male', category: 'Bull' }),
      seedAnimal({ id: 'bull-2', sex: 'Male', category: 'Bull' }),
      seedAnimal({ id: 'cow-1', sex: 'Female', category: 'Cow' }),
      seedAnimal({ id: 'cow-2', sex: 'Female', category: 'Cow' }),
      seedAnimal({ id: 'cow-3', sex: 'Female', category: 'Heifer' }),
    ];
    const prisma = makeMockPrisma(animals);

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm');

    expect(result.pairings).toEqual([]);
    expect(result.reason).toBe('NO_PEDIGREE_SEED');
  });

  it('does NOT return NO_PEDIGREE_SEED when at least one animal has a motherId', async () => {
    const animals: AnimalSeed[] = [
      seedAnimal({ id: 'bull-1', sex: 'Male', category: 'Bull' }),
      seedAnimal({ id: 'cow-1', motherId: 'old-cow' }),
    ];
    const prisma = makeMockPrisma(animals);

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm');

    expect(result.reason).not.toBe('NO_PEDIGREE_SEED');
  });

  it('does NOT return NO_PEDIGREE_SEED when at least one animal has a fatherId', async () => {
    const animals: AnimalSeed[] = [
      seedAnimal({ id: 'bull-1', sex: 'Male', category: 'Bull' }),
      seedAnimal({ id: 'cow-1', fatherId: 'old-bull' }),
    ];
    const prisma = makeMockPrisma(animals);

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm');

    expect(result.reason).not.toBe('NO_PEDIGREE_SEED');
  });

  it('returns NO_PEDIGREE_SEED when farm has zero animals (nothing to pair)', async () => {
    const prisma = makeMockPrisma([]);

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm');

    // An empty herd has no pedigree by definition — fall through to the
    // most-helpful empty-state (import pedigree).
    expect(result.pairings).toEqual([]);
    expect(result.reason).toBe('NO_PEDIGREE_SEED');
  });

  it('returns NO_BULLS when pedigree exists but herd has no bulls', async () => {
    const animals: AnimalSeed[] = [
      seedAnimal({ id: 'cow-1', motherId: 'old-cow' }),
      seedAnimal({ id: 'cow-2', fatherId: 'old-bull' }),
    ];
    const prisma = makeMockPrisma(animals);

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm');

    expect(result.pairings).toEqual([]);
    expect(result.reason).toBe('NO_BULLS');
  });

  it('returns NO_OPEN_COWS when pedigree + bulls exist but all cows are pregnant or missing', async () => {
    const animals: AnimalSeed[] = [
      seedAnimal({ id: 'bull-1', sex: 'Male', category: 'Bull', motherId: 'ancestor' }),
    ];
    const prisma = makeMockPrisma(animals);

    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm');

    expect(result.pairings).toEqual([]);
    expect(result.reason).toBe('NO_OPEN_COWS');
  });

  it('returns NO_PEDIGREE_SEED when a 200-head herd has only 1 animal with pedigree (1%)', async () => {
    // Regression for the code-review MEDIUM — the old `.some()` check
    // admitted any herd with a single pedigreed animal. A 1%-seed herd
    // still produces 99.9% of pairings at COI=0, which looks analytical
    // but is meaningless. New threshold requires 10% with pedigree.
    const animals: AnimalSeed[] = [];
    for (let i = 0; i < 200; i++) {
      animals.push(
        seedAnimal({
          id: `a-${i}`,
          sex: i % 2 === 0 ? 'Female' : 'Male',
          category: i % 2 === 0 ? 'Cow' : 'Bull',
          motherId: i === 0 ? 'ancestor-cow' : null,
          fatherId: null,
        }),
      );
    }
    const prisma = makeMockPrisma(animals);
    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm');
    expect(result.reason).toBe('NO_PEDIGREE_SEED');
  });

  it('flows through when a 200-head herd has 10% pedigree seed', async () => {
    const animals: AnimalSeed[] = [];
    for (let i = 0; i < 200; i++) {
      animals.push(
        seedAnimal({
          id: `a-${i}`,
          sex: i % 2 === 0 ? 'Female' : 'Male',
          category: i % 2 === 0 ? 'Cow' : 'Bull',
          motherId: i < 20 ? 'ancestor-cow' : null,
          fatherId: null,
        }),
      );
    }
    const prisma = makeMockPrisma(animals);
    const { suggestPairings } = await import('@/lib/server/breeding-analytics');
    const result = await suggestPairings(prisma, 'test-farm');
    expect(result.reason).not.toBe('NO_PEDIGREE_SEED');
  });
});
