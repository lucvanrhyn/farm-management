// @vitest-environment node
/**
 * lib/server/__tests__/species-scoped-prisma.test.ts
 *
 * Behaviour + type-level contract for the species-scoped Prisma facade.
 *
 * PRD #222 / issue #224. The facade is the structural cure for the class of
 * bug where a developer reaches for `prisma.animal.findMany(...)` on a
 * per-species surface, forgets the species axis, and silently leaks rows
 * from other species into the response. The fix is structural: make
 * "forgetting the mode" a compile error, not a code-review judgement call.
 *
 * Two assertion layers:
 *   1. Runtime — call the facade with a mocked PrismaClient and assert the
 *      injected `where` shape.
 *   2. Compile-time — `// @ts-expect-error` markers on the calls that MUST
 *      not compile. If the facade's signature ever weakens such that
 *      `scoped(prisma)` (no mode) becomes legal, the `@ts-expect-error`
 *      lines fire as type errors and the test file fails to typecheck.
 */
import { describe, it, expect, vi } from 'vitest';
import { scoped } from '../species-scoped-prisma';
import type { PrismaClient } from '@prisma/client';

type AnyArgs = Record<string, unknown>;

// Build a Prisma-shaped spy that captures the args passed to each method.
// We don't pull in a Prisma-mock framework — the surface we exercise is small
// and the only thing the test cares about is the `where` shape after the
// facade injects the species predicate.
function makeSpyPrisma() {
  const calls: Record<string, AnyArgs[]> = {};
  const record = (key: string) => (args?: AnyArgs) => {
    (calls[key] ??= []).push(args ?? {});
    return Promise.resolve([] as unknown);
  };
  const prisma = {
    animal: {
      findMany: vi.fn(record('animal.findMany')),
      findFirst: vi.fn(record('animal.findFirst')),
      findUnique: vi.fn(record('animal.findUnique')),
      count: vi.fn(record('animal.count')),
      groupBy: vi.fn(record('animal.groupBy')),
      updateMany: vi.fn(record('animal.updateMany')),
      deleteMany: vi.fn(record('animal.deleteMany')),
    },
    camp: {
      findMany: vi.fn(record('camp.findMany')),
      findFirst: vi.fn(record('camp.findFirst')),
      count: vi.fn(record('camp.count')),
      updateMany: vi.fn(record('camp.updateMany')),
      deleteMany: vi.fn(record('camp.deleteMany')),
    },
    mob: {
      findMany: vi.fn(record('mob.findMany')),
      findFirst: vi.fn(record('mob.findFirst')),
      count: vi.fn(record('mob.count')),
      updateMany: vi.fn(record('mob.updateMany')),
      deleteMany: vi.fn(record('mob.deleteMany')),
    },
    observation: {
      findMany: vi.fn(record('observation.findMany')),
      findFirst: vi.fn(record('observation.findFirst')),
      count: vi.fn(record('observation.count')),
      updateMany: vi.fn(record('observation.updateMany')),
      deleteMany: vi.fn(record('observation.deleteMany')),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, calls };
}

describe('scoped() — species-scoped Prisma facade', () => {
  describe('animal builder', () => {
    it('injects { species, status: "Active" } on findMany when caller passes no where', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await scoped(prisma, 'cattle').animal.findMany({});
      expect(calls['animal.findMany'][0].where).toEqual({
        species: 'cattle',
        status: 'Active',
      });
    });

    it('merges caller-supplied where with species + Active predicate', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await scoped(prisma, 'sheep').animal.findMany({
        where: { currentCamp: 'NORTH-01' },
        orderBy: { animalId: 'asc' },
      });
      expect(calls['animal.findMany'][0].where).toEqual({
        currentCamp: 'NORTH-01',
        species: 'sheep',
        status: 'Active',
      });
      // Non-where args must pass through unchanged.
      expect(calls['animal.findMany'][0].orderBy).toEqual({ animalId: 'asc' });
    });

    it('caller-supplied species/status take precedence (escape hatch for legacy code)', async () => {
      // If a caller explicitly wants to override (e.g. fetching ALL statuses
      // for an archived-view), they can — the facade injects defaults but
      // does not clobber explicit caller intent. This is the same shape as
      // every "default + override" merge in the codebase.
      const { prisma, calls } = makeSpyPrisma();
      await scoped(prisma, 'cattle').animal.findMany({
        where: { status: 'Sold' },
      });
      expect(calls['animal.findMany'][0].where).toEqual({
        species: 'cattle',
        status: 'Sold',
      });
    });

    it('count uses species-only predicate (status filter is reads-only)', async () => {
      // count() is used for both "active head" (which needs status:Active)
      // and "total head including inactive". Injecting status:Active here
      // would break the latter. The facade injects ONLY species for count;
      // callers add the status filter when they need it. The findMany path
      // is different because the dominant surface (per-species admin list)
      // wants Active-only by default — see the Wave A2 active-species
      // helper for the reasoning.
      const { prisma, calls } = makeSpyPrisma();
      await scoped(prisma, 'cattle').animal.count({ where: { currentCamp: 'X' } });
      expect(calls['animal.count'][0].where).toEqual({
        currentCamp: 'X',
        species: 'cattle',
      });
    });

    it('updateMany injects species predicate but never status', async () => {
      // Mutations like "mark all sheep in camp X as Sold" must operate on
      // both Active and non-Active rows of the species. status injection
      // here would silently narrow the update set.
      const { prisma, calls } = makeSpyPrisma();
      await scoped(prisma, 'sheep').animal.updateMany({
        where: { currentCamp: 'X' },
        data: { status: 'Sold' },
      });
      expect(calls['animal.updateMany'][0].where).toEqual({
        currentCamp: 'X',
        species: 'sheep',
      });
      expect(calls['animal.updateMany'][0].data).toEqual({ status: 'Sold' });
    });
  });

  describe('camp builder', () => {
    it('injects species on camp.findMany', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await scoped(prisma, 'sheep').camp.findMany({ orderBy: { campName: 'asc' } });
      expect(calls['camp.findMany'][0].where).toEqual({ species: 'sheep' });
      expect(calls['camp.findMany'][0].orderBy).toEqual({ campName: 'asc' });
    });

    it('injects species on camp.count', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await scoped(prisma, 'game').camp.count();
      expect(calls['camp.count'][0].where).toEqual({ species: 'game' });
    });
  });

  describe('mob builder', () => {
    it('injects species on mob.findMany', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await scoped(prisma, 'cattle').mob.findMany({});
      expect(calls['mob.findMany'][0].where).toEqual({ species: 'cattle' });
    });
  });

  describe('observation builder', () => {
    it('injects species on observation.findMany (column-based predicate)', async () => {
      // Observation.species is the denormalised column added in migration
      // 0003 (Phase I.3). The facade filters on it directly. Rows where
      // species is NULL (e.g. orphan animalId or pre-backfill rows) are
      // intentionally excluded from per-species views — they show up in
      // the cross-species feed handled outside the facade.
      const { prisma, calls } = makeSpyPrisma();
      await scoped(prisma, 'cattle').observation.findMany({
        where: { type: 'weighing' },
      });
      expect(calls['observation.findMany'][0].where).toEqual({
        type: 'weighing',
        species: 'cattle',
      });
    });
  });

  describe('cross-species mode handling', () => {
    it('routes all three species through the same builder shape', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await scoped(prisma, 'cattle').animal.count({});
      await scoped(prisma, 'sheep').animal.count({});
      await scoped(prisma, 'game').animal.count({});
      expect(calls['animal.count'].map((c) => (c.where as { species: string }).species))
        .toEqual(['cattle', 'sheep', 'game']);
    });
  });
});

// ─── Compile-time contract tests ────────────────────────────────────
// These assertions exist purely to make sure tsc fails if the facade ever
// regresses to allow a missing-mode call. The runtime body is intentionally
// trivial; the value is in the `@ts-expect-error` markers above each call.
describe('compile-time signature contract', () => {
  it('refuses to compile a scoped() call missing the mode argument', () => {
    const { prisma } = makeSpyPrisma();
    // @ts-expect-error — `mode: SpeciesId` is required; calling scoped()
    // with only a PrismaClient must be a type error. If this stops erroring
    // the facade has weakened to accept callers without a mode, defeating
    // the entire #224 contract.
    scoped(prisma);
    expect(true).toBe(true);
  });

  it('refuses to compile a scoped() call with an invalid mode string', () => {
    const { prisma } = makeSpyPrisma();
    // @ts-expect-error — `mode` is the SpeciesId literal union, not
    // `string`. "fish" must not be assignable. If this stops erroring,
    // the union has been widened — a regression that lets new species
    // slip in untyped.
    scoped(prisma, 'fish');
    expect(true).toBe(true);
  });

  it('preserves SpeciesId narrowing — "cattle" | "sheep" | "game" only', () => {
    const { prisma } = makeSpyPrisma();
    // Positive control. These must compile.
    scoped(prisma, 'cattle');
    scoped(prisma, 'sheep');
    scoped(prisma, 'game');
    expect(true).toBe(true);
  });
});
