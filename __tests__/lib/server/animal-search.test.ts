// @vitest-environment node
/**
 * __tests__/lib/server/animal-search.test.ts
 *
 * Behaviour test for `AnimalSearchQuery` (`lib/server/animal-search.ts`).
 *
 * Issue #255 (Wave 4 of PRD #250). Production stress-test 2026-05-13 surfaced
 * that searching for `BB-C013` after that animal was marked Deceased returned
 * "0 animals found" — the catalogue, the tag search, AND the Deceased tab
 * counter all silently excluded deceased rows because the underlying query
 * went through `scoped(prisma, mode).animal.findMany` which injects
 * `status: "Active"` by default (see `lib/server/species-scoped-prisma.ts`).
 *
 * The structural cure: every animal-listing surface routes through this
 * deep module which REQUIRES an explicit `includeDeceased: boolean` flag.
 * Forgetting the flag is a TypeScript error — not a runtime symptom that
 * silently drops rows.
 *
 * Two assertion layers (mirrors `__tests__/lib/server/species-scoped-prisma.test.ts`):
 *   1. Runtime — call the helper with a spy Prisma and assert the
 *      composed `where` shape.
 *   2. Compile-time — `// @ts-expect-error` markers on the calls that
 *      MUST not compile. If the signature ever weakens such that
 *      `searchAnimals(prisma, { mode })` (no flag) becomes legal, the
 *      `@ts-expect-error` lines fire as type errors and this file fails
 *      to typecheck.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  searchAnimals,
  countAnimalsByStatus,
} from '@/lib/server/animal-search';
import type { PrismaClient } from '@prisma/client';

type AnyArgs = Record<string, unknown>;

function makeSpyPrisma(rows: unknown[] = []) {
  const calls: Record<string, AnyArgs[]> = {};
  const recordReturning =
    (key: string, value: unknown) => (args?: AnyArgs) => {
      (calls[key] ??= []).push(args ?? {});
      return Promise.resolve(value);
    };
  const prisma = {
    animal: {
      findMany: vi.fn(recordReturning('animal.findMany', rows)),
      count: vi.fn(recordReturning('animal.count', rows.length)),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, calls };
}

describe('searchAnimals — catalogue / tag-search query', () => {
  it('does NOT inject any status predicate when includeDeceased: true', async () => {
    // The bug: `scoped(prisma, mode).animal.findMany` injects
    // `status: "Active"` so deceased rows are invisible to the catalogue.
    // The fix: this module routes through raw prisma so it can omit the
    // status filter entirely when the caller asks for everything.
    const { prisma, calls } = makeSpyPrisma();
    await searchAnimals(prisma, { mode: 'cattle', includeDeceased: true });
    expect(calls['animal.findMany']).toHaveLength(1);
    expect(calls['animal.findMany'][0].where).toEqual({ species: 'cattle' });
    expect((calls['animal.findMany'][0].where as Record<string, unknown>).status).toBeUndefined();
  });

  it('injects status: "Active" only when includeDeceased: false (active picker mode)', async () => {
    // Mob assignment / move-target pickers explicitly want only Active rows.
    // The flag is required so this is a deliberate, auditable opt-out.
    const { prisma, calls } = makeSpyPrisma();
    await searchAnimals(prisma, { mode: 'sheep', includeDeceased: false });
    expect(calls['animal.findMany'][0].where).toEqual({
      species: 'sheep',
      status: 'Active',
    });
  });

  it('preserves caller-supplied where keys without overriding the species axis', async () => {
    const { prisma, calls } = makeSpyPrisma();
    await searchAnimals(prisma, {
      mode: 'cattle',
      includeDeceased: true,
      where: { currentCamp: 'NORTH-01', category: 'Breeding cow' },
    });
    expect(calls['animal.findMany'][0].where).toEqual({
      species: 'cattle',
      currentCamp: 'NORTH-01',
      category: 'Breeding cow',
    });
  });

  it('forwards orderBy / take / cursor / skip / select unchanged', async () => {
    const { prisma, calls } = makeSpyPrisma();
    await searchAnimals(prisma, {
      mode: 'cattle',
      includeDeceased: true,
      orderBy: [{ category: 'asc' }, { animalId: 'asc' }],
      take: 50,
      cursor: { animalId: 'BB-C012' },
      skip: 1,
    });
    const args = calls['animal.findMany'][0];
    expect(args.orderBy).toEqual([{ category: 'asc' }, { animalId: 'asc' }]);
    expect(args.take).toBe(50);
    expect(args.cursor).toEqual({ animalId: 'BB-C012' });
    expect(args.skip).toBe(1);
  });

  it('supports tag/name search via the `search` shortcut, includes deceased rows', async () => {
    // The exact prod regression: searching "BB-C013" after death must return
    // the row. The shortcut composes the OR predicate the API route was
    // already doing — but routed through a path that does not exclude
    // deceased.
    const { prisma, calls } = makeSpyPrisma();
    await searchAnimals(prisma, {
      mode: 'cattle',
      includeDeceased: true,
      search: 'BB-C013',
    });
    expect(calls['animal.findMany'][0].where).toEqual({
      species: 'cattle',
      OR: [
        { animalId: { contains: 'BB-C013' } },
        { name: { contains: 'BB-C013' } },
      ],
    });
  });

  it('compile-time: forgetting includeDeceased is a TypeScript error', async () => {
    // If you change the signature so `includeDeceased` becomes optional or
    // gets a default, this @ts-expect-error fires and the file fails to
    // typecheck. That breakage is the whole point of the deep module — the
    // bug class lives in the omission, so we make the omission impossible.
    const { prisma } = makeSpyPrisma();
    // @ts-expect-error includeDeceased is required
    await searchAnimals(prisma, { mode: 'cattle' });
    // @ts-expect-error mode is required
    await searchAnimals(prisma, { includeDeceased: true });
  });
});

describe('countAnimalsByStatus — drives the Deceased tab badge', () => {
  it('returns separate counts for active / sold / deceased per species', async () => {
    // The Deceased tab badge in `AnimalsTable` previously filtered the
    // hydrated array client-side — but the array contained zero deceased
    // rows because the SSR query injected status: "Active". The fix:
    // SSR computes the bucket counts via this helper and hands them to
    // the client component, so the badge is always accurate even before
    // any deceased row is hydrated.
    let n = 0;
    const fakeCounts = [42, 7, 3];
    const calls: AnyArgs[] = [];
    const prisma = {
      animal: {
        count: vi.fn((args?: AnyArgs) => {
          calls.push(args ?? {});
          return Promise.resolve(fakeCounts[n++]);
        }),
      },
    } as unknown as PrismaClient;

    const result = await countAnimalsByStatus(prisma, 'cattle');

    expect(result).toEqual({ active: 42, sold: 7, deceased: 3 });
    expect(calls).toHaveLength(3);
    expect(calls[0].where).toEqual({ species: 'cattle', status: 'Active' });
    expect(calls[1].where).toEqual({ species: 'cattle', status: 'Sold' });
    expect(calls[2].where).toEqual({ species: 'cattle', status: 'Deceased' });
  });
});
