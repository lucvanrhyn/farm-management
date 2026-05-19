// @vitest-environment node
/**
 * lib/server/__tests__/cross-species-prisma.test.ts
 *
 * Behaviour + type-level contract for the cross-species Prisma door.
 *
 * ADR-0005. `crossSpecies(prisma, reason)` is the typed counterpart to
 * `scoped(prisma, mode)`: it deliberately spans every species. Where
 * `scoped()` injects a species predicate, `crossSpecies()` injects
 * NOTHING — it is a transparent forwarder. The required `reason` argument
 * is a compile-time classification marker so the "this query intentionally
 * crosses species" decision lives in the type system at the call site.
 *
 * Two assertion layers:
 *   1. Runtime — call the door with a mocked PrismaClient and assert the
 *      args reach the underlying delegate verbatim, with NO species key
 *      injected.
 *   2. Compile-time — `// @ts-expect-error` markers on the calls that MUST
 *      not compile (missing reason, invalid reason literal).
 */
import { describe, it, expect, vi } from 'vitest';
import { crossSpecies } from '../species-scoped-prisma';
import type { CrossSpeciesReason } from '../species-scoped-prisma';
import type { PrismaClient } from '@prisma/client';

type AnyArgs = Record<string, unknown>;

// Build a Prisma-shaped spy that captures the args passed to each method.
// Mirrors the harness in species-scoped-prisma.test.ts — the only thing this
// test cares about is that the door forwards args UNCHANGED (no species).
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
      groupBy: vi.fn(record('camp.groupBy')),
      updateMany: vi.fn(record('camp.updateMany')),
      deleteMany: vi.fn(record('camp.deleteMany')),
    },
    mob: {
      findMany: vi.fn(record('mob.findMany')),
      findFirst: vi.fn(record('mob.findFirst')),
      count: vi.fn(record('mob.count')),
      groupBy: vi.fn(record('mob.groupBy')),
      updateMany: vi.fn(record('mob.updateMany')),
      deleteMany: vi.fn(record('mob.deleteMany')),
    },
    observation: {
      findMany: vi.fn(record('observation.findMany')),
      findFirst: vi.fn(record('observation.findFirst')),
      count: vi.fn(record('observation.count')),
      groupBy: vi.fn(record('observation.groupBy')),
      updateMany: vi.fn(record('observation.updateMany')),
      deleteMany: vi.fn(record('observation.deleteMany')),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, calls };
}

describe('crossSpecies() — cross-species Prisma door', () => {
  describe('animal builder', () => {
    it('forwards findMany args verbatim — no species injected', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'analytics-rollup').animal.findMany({
        where: { status: 'Active' },
      });
      expect(calls['animal.findMany'][0].where).toEqual({ status: 'Active' });
      expect(calls['animal.findMany'][0].where).not.toHaveProperty('species');
    });

    it('injects no where at all when called with no args', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'einstein-rag').animal.findMany();
      expect(calls['animal.findMany'][0]).not.toHaveProperty('where');
    });

    it('injects no where on empty args object', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'farm-wide-audit').animal.findMany({});
      expect(calls['animal.findMany'][0]).not.toHaveProperty('where');
    });

    it('forwards findFirst args verbatim', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'einstein-rag').animal.findFirst({
        where: { animalId: 'A-1' },
      });
      expect(calls['animal.findFirst'][0].where).toEqual({ animalId: 'A-1' });
      expect(calls['animal.findFirst'][0].where).not.toHaveProperty('species');
    });

    it('forwards findUnique args verbatim', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'species-registry-internal').animal.findUnique({
        where: { id: 'cuid-1' },
      });
      expect(calls['animal.findUnique'][0].where).toEqual({ id: 'cuid-1' });
      expect(calls['animal.findUnique'][0].where).not.toHaveProperty('species');
    });

    it('forwards count args verbatim', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'analytics-rollup').animal.count({
        where: { status: 'Active' },
      });
      expect(calls['animal.count'][0].where).toEqual({ status: 'Active' });
      expect(calls['animal.count'][0].where).not.toHaveProperty('species');
    });

    it('forwards groupBy args verbatim', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'analytics-rollup').animal.groupBy({
        by: ['species'],
        where: { status: 'Active' },
      } as never);
      expect(calls['animal.groupBy'][0].where).toEqual({ status: 'Active' });
      expect(calls['animal.groupBy'][0].by).toEqual(['species']);
      expect(calls['animal.groupBy'][0].where).not.toHaveProperty('species');
    });

    it('forwards updateMany args verbatim', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'farm-wide-audit').animal.updateMany({
        where: { status: 'Active' },
        data: { status: 'Sold' },
      });
      expect(calls['animal.updateMany'][0].where).toEqual({ status: 'Active' });
      expect(calls['animal.updateMany'][0].data).toEqual({ status: 'Sold' });
      expect(calls['animal.updateMany'][0].where).not.toHaveProperty('species');
    });

    it('forwards deleteMany args verbatim', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'farm-wide-audit').animal.deleteMany({
        where: { status: 'Dead' },
      });
      expect(calls['animal.deleteMany'][0].where).toEqual({ status: 'Dead' });
      expect(calls['animal.deleteMany'][0].where).not.toHaveProperty('species');
    });
  });

  describe('camp builder', () => {
    it('forwards findMany args verbatim — no species injected', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'farm-wide-audit').camp.findMany({
        orderBy: { campName: 'asc' },
      });
      expect(calls['camp.findMany'][0]).not.toHaveProperty('where');
      expect(calls['camp.findMany'][0].orderBy).toEqual({ campName: 'asc' });
    });

    it('forwards findFirst / count / updateMany / deleteMany verbatim', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'analytics-rollup').camp.findFirst({
        where: { campId: 'C-1' },
      });
      await crossSpecies(prisma, 'analytics-rollup').camp.count({
        where: { campId: 'C-1' },
      });
      await crossSpecies(prisma, 'analytics-rollup').camp.updateMany({
        where: { campId: 'C-1' },
        data: { rotationNotes: 'x' },
      });
      await crossSpecies(prisma, 'analytics-rollup').camp.deleteMany({
        where: { campId: 'C-1' },
      });
      expect(calls['camp.findFirst'][0].where).toEqual({ campId: 'C-1' });
      expect(calls['camp.count'][0].where).toEqual({ campId: 'C-1' });
      expect(calls['camp.updateMany'][0].where).toEqual({ campId: 'C-1' });
      expect(calls['camp.updateMany'][0].data).toEqual({ rotationNotes: 'x' });
      expect(calls['camp.deleteMany'][0].where).toEqual({ campId: 'C-1' });
      for (const k of ['camp.findFirst', 'camp.count', 'camp.updateMany', 'camp.deleteMany']) {
        expect(calls[k][0].where).not.toHaveProperty('species');
      }
    });
  });

  describe('camp/mob groupBy', () => {
    it('forwards camp.groupBy and mob.groupBy verbatim — no species injected', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'analytics-rollup').camp.groupBy({
        by: ['campId'],
        where: { campId: { not: '' } },
      } as never);
      await crossSpecies(prisma, 'analytics-rollup').mob.groupBy({
        by: ['name'],
        where: { name: { not: '' } },
      } as never);
      expect(calls['camp.groupBy'][0].where).toEqual({ campId: { not: '' } });
      expect(calls['camp.groupBy'][0].where).not.toHaveProperty('species');
      expect(calls['mob.groupBy'][0].where).toEqual({ name: { not: '' } });
      expect(calls['mob.groupBy'][0].where).not.toHaveProperty('species');
    });
  });

  describe('mob builder', () => {
    it('forwards every method verbatim — no species injected', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'analytics-rollup').mob.findMany({
        where: { name: 'M' },
      });
      await crossSpecies(prisma, 'analytics-rollup').mob.findFirst({
        where: { name: 'M' },
      });
      await crossSpecies(prisma, 'analytics-rollup').mob.count({
        where: { name: 'M' },
      });
      await crossSpecies(prisma, 'analytics-rollup').mob.updateMany({
        where: { name: 'M' },
        data: { name: 'N' },
      });
      await crossSpecies(prisma, 'analytics-rollup').mob.deleteMany({
        where: { name: 'M' },
      });
      for (const k of [
        'mob.findMany',
        'mob.findFirst',
        'mob.count',
        'mob.updateMany',
        'mob.deleteMany',
      ]) {
        expect(calls[k][0].where).toEqual({ name: 'M' });
        expect(calls[k][0].where).not.toHaveProperty('species');
      }
    });
  });

  describe('observation builder', () => {
    it('forwards groupBy args verbatim — no species injected', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'analytics-rollup').observation.groupBy({
        by: ['campId'],
        where: { type: 'health_issue' },
        _count: { id: true },
      } as never);
      expect(calls['observation.groupBy'][0].where).toEqual({
        type: 'health_issue',
      });
      expect(calls['observation.groupBy'][0].by).toEqual(['campId']);
      expect(calls['observation.groupBy'][0]._count).toEqual({ id: true });
      expect(calls['observation.groupBy'][0].where).not.toHaveProperty('species');
    });

    it('forwards every method verbatim — no species injected', async () => {
      const { prisma, calls } = makeSpyPrisma();
      await crossSpecies(prisma, 'notification-cron').observation.findMany({
        where: { type: 'weighing' },
      });
      await crossSpecies(prisma, 'notification-cron').observation.findFirst({
        where: { type: 'weighing' },
      });
      await crossSpecies(prisma, 'notification-cron').observation.count({
        where: { type: 'weighing' },
      });
      await crossSpecies(prisma, 'notification-cron').observation.updateMany({
        where: { type: 'weighing' },
        data: { type: 'bcs' },
      });
      await crossSpecies(prisma, 'notification-cron').observation.deleteMany({
        where: { type: 'weighing' },
      });
      for (const k of [
        'observation.findMany',
        'observation.findFirst',
        'observation.count',
        'observation.updateMany',
        'observation.deleteMany',
      ]) {
        expect(calls[k][0].where).toEqual({ type: 'weighing' });
        expect(calls[k][0].where).not.toHaveProperty('species');
      }
    });
  });

  describe('reason argument', () => {
    it('accepts every valid CrossSpeciesReason and forwards identically', async () => {
      const reasons: CrossSpeciesReason[] = [
        'einstein-rag',
        'analytics-rollup',
        'notification-cron',
        'farm-wide-audit',
        'species-registry-internal',
      ];
      const { prisma, calls } = makeSpyPrisma();
      for (const reason of reasons) {
        await crossSpecies(prisma, reason).animal.count({ where: { status: 'Active' } });
      }
      expect(calls['animal.count']).toHaveLength(reasons.length);
      for (const c of calls['animal.count']) {
        expect(c.where).toEqual({ status: 'Active' });
      }
    });
  });
});

// ─── Compile-time contract tests ────────────────────────────────────
// These assertions exist purely so tsc fails if the door ever regresses to
// allow a missing/invalid reason. The runtime body is intentionally trivial;
// the value is in the `@ts-expect-error` markers above each call.
describe('compile-time signature contract', () => {
  it('refuses to compile a crossSpecies() call missing the reason argument', () => {
    const { prisma } = makeSpyPrisma();
    // @ts-expect-error — `reason: CrossSpeciesReason` is required; calling
    // crossSpecies() with only a PrismaClient must be a type error. If this
    // stops erroring the door has weakened to accept callers without a
    // classification, defeating the ADR-0005 contract.
    crossSpecies(prisma);
    expect(true).toBe(true);
  });

  it('refuses to compile a crossSpecies() call with an invalid reason', () => {
    const { prisma } = makeSpyPrisma();
    // @ts-expect-error — `reason` is the CrossSpeciesReason literal union,
    // not `string`. "not-a-reason" must not be assignable. If this stops
    // erroring, the union has been widened to accept arbitrary strings.
    crossSpecies(prisma, 'not-a-reason');
    expect(true).toBe(true);
  });

  it('accepts the five valid CrossSpeciesReason literals', () => {
    const { prisma } = makeSpyPrisma();
    // Positive control. These must compile.
    crossSpecies(prisma, 'einstein-rag');
    crossSpecies(prisma, 'analytics-rollup');
    crossSpecies(prisma, 'notification-cron');
    crossSpecies(prisma, 'farm-wide-audit');
    crossSpecies(prisma, 'species-registry-internal');
    expect(true).toBe(true);
  });
});
