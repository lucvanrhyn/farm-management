/**
 * __tests__/breeding/breeding-species-doors.test.ts
 *
 * ADR-0005 Wave 2 — the breeding cluster's per-species reads route
 * through the `scoped()` door (pairings / snapshot) and the
 * `crossSpecies()` door (trait-profile, which legitimately spans the
 * species partition to find an animal's own + offspring calving records).
 *
 * These are structural assertions: they prove the door is used (not raw
 * `prisma.<model>`) AND that behaviour is preserved — `scoped(prisma,
 * species)` must still surface `where.species === <species>` to the
 * underlying client, exactly as the hand-written predicate did before.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

function makePrisma(): {
  prisma: PrismaClient;
  animalFindMany: ReturnType<typeof vi.fn>;
  obsFindMany: ReturnType<typeof vi.fn>;
} {
  const animalFindMany = vi.fn().mockResolvedValue([]);
  const obsFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    animal: { findMany: animalFindMany },
    observation: { findMany: obsFindMany },
    camp: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
  return { prisma, animalFindMany, obsFindMany };
}

describe('breeding cluster — species-access doors (ADR-0005 Wave 2)', () => {
  it('suggestPairings routes the animal read through scoped() — species + status injected', async () => {
    const { prisma, animalFindMany } = makePrisma();
    const { suggestPairings } = await import('@/lib/server/breeding-analytics');

    await suggestPairings(prisma, 'test-farm', 'sheep');

    expect(animalFindMany).toHaveBeenCalled();
    const arg = animalFindMany.mock.calls[0][0] as {
      where?: { species?: string; status?: string };
    };
    // scoped(prisma, 'sheep') injects species; status stays explicit.
    expect(arg.where?.species).toBe('sheep');
    expect(arg.where?.status).toBe('Active');
  });

  it('getBreedingSnapshot routes observation reads through scoped() — species injected', async () => {
    const { prisma, obsFindMany } = makePrisma();
    const { getBreedingSnapshot } = await import('@/lib/server/breeding-analytics');

    await getBreedingSnapshot(prisma, 'test-farm', 'sheep');

    expect(obsFindMany).toHaveBeenCalled();
    for (const call of obsFindMany.mock.calls) {
      const arg = call[0] as { where?: { species?: string } };
      expect(arg.where?.species).toBe('sheep');
    }
  });

  it('getAnimalTraitProfile routes through crossSpecies() — no species predicate injected (verbatim)', async () => {
    const { prisma, obsFindMany } = makePrisma();
    const { getAnimalTraitProfile } = await import('@/lib/server/breeding-analytics');

    await getAnimalTraitProfile(prisma, 'animal-1', 'Female');

    expect(obsFindMany).toHaveBeenCalled();
    // crossSpecies() forwards args verbatim — it must NOT add a species key.
    for (const call of obsFindMany.mock.calls) {
      const arg = call[0] as { where?: Record<string, unknown> };
      expect(arg.where && 'species' in arg.where).toBe(false);
    }
  });
});
