// @vitest-environment node
/**
 * __tests__/lib/server/animal-photos.test.ts
 *
 * Behaviour test for `getAnimalPhotos` — the photo-aggregation query
 * that backs the admin animal-detail Photos tab (issue #264).
 *
 * Photos in FarmTrack live as `Observation.attachmentUrl` strings on
 * any observation row — no dedicated `Photo` table. The aggregation
 * therefore reads from `prisma.observation` filtering to the requested
 * animalId AND `attachmentUrl: { not: null }`, ordered by `observedAt`
 * descending so the most recent capture sits at the top of the tab.
 *
 * The acceptance criterion explicitly requires "asserts photos from all
 * obs types are aggregated" — we verify the query does NOT filter on
 * observation `type`, so a Health-issue photo, a Treatment photo, a
 * Calving photo, and a Death photo all surface in the same response.
 *
 * Per ADR-0003 the per-species facade injects `species:` only on
 * cookie-driven surfaces. This query is animalId-scoped (single-row
 * primary axis), which is intrinsically scoped — listed in the
 * `audit-species-where` baseline alongside the other animal-id
 * observation reads on this page.
 */
import { describe, it, expect, vi } from 'vitest';
import { getAnimalPhotos } from '@/lib/server/animal-photos';
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
    observation: {
      findMany: vi.fn(recordReturning('observation.findMany', rows)),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, calls };
}

describe('getAnimalPhotos — animal photo aggregation', () => {
  it('queries observations for the given animalId with non-null attachmentUrl', async () => {
    const { prisma, calls } = makeSpyPrisma([]);
    await getAnimalPhotos(prisma, 'BB-C013');

    expect(calls['observation.findMany']).toHaveLength(1);
    const args = calls['observation.findMany'][0];
    expect(args.where).toEqual({
      animalId: 'BB-C013',
      attachmentUrl: { not: null },
    });
  });

  it('orders results by observedAt descending so newest photos appear first', async () => {
    const { prisma, calls } = makeSpyPrisma([]);
    await getAnimalPhotos(prisma, 'BB-C013');

    const args = calls['observation.findMany'][0];
    expect(args.orderBy).toEqual({ observedAt: 'desc' });
  });

  it('selects only the columns needed to render the photo tile (id, type, observedAt, attachmentUrl)', async () => {
    // No `select` projection means Prisma returns every column on every
    // row — wasteful and a known anti-pattern (audit-findmany-no-select).
    // A photo tile only renders the URL, capture timestamp, and obs type
    // (badge + back-link). Project to those four columns at the query.
    const { prisma, calls } = makeSpyPrisma([]);
    await getAnimalPhotos(prisma, 'BB-C013');

    const args = calls['observation.findMany'][0];
    expect(args.select).toEqual({
      id: true,
      type: true,
      observedAt: true,
      attachmentUrl: true,
    });
  });

  it('does NOT filter on observation type — photos from health, treatment, calving, and death are all aggregated', async () => {
    // The acceptance criterion is explicit: "asserts photos from all obs
    // types are aggregated". The query MUST NOT include a `type` clause
    // in its where predicate; otherwise a Health-only filter would mask
    // the Treatment / Calving / Death photos.
    const { prisma, calls } = makeSpyPrisma([
      { id: 'o1', type: 'health_issue', observedAt: new Date('2026-05-10'), attachmentUrl: 'https://cdn/h.jpg' },
      { id: 'o2', type: 'treatment',    observedAt: new Date('2026-05-09'), attachmentUrl: 'https://cdn/t.jpg' },
      { id: 'o3', type: 'calving',      observedAt: new Date('2026-05-08'), attachmentUrl: 'https://cdn/c.jpg' },
      { id: 'o4', type: 'death',        observedAt: new Date('2026-05-07'), attachmentUrl: 'https://cdn/d.jpg' },
    ]);

    const photos = await getAnimalPhotos(prisma, 'BB-C013');

    const args = calls['observation.findMany'][0];
    expect((args.where as Record<string, unknown>).type).toBeUndefined();

    const types = photos.map((p) => p.type).sort();
    expect(types).toEqual(['calving', 'death', 'health_issue', 'treatment']);
  });

  it('returns an empty array when the animal has no photos', async () => {
    const { prisma } = makeSpyPrisma([]);
    const photos = await getAnimalPhotos(prisma, 'BB-NEW-001');
    expect(photos).toEqual([]);
  });

  it('returns the photo records as-is (no shape massaging beyond what Prisma returned)', async () => {
    const rows = [
      { id: 'o1', type: 'health_issue', observedAt: new Date('2026-05-10'), attachmentUrl: 'https://cdn/h.jpg' },
    ];
    const { prisma } = makeSpyPrisma(rows);
    const photos = await getAnimalPhotos(prisma, 'BB-C013');
    expect(photos).toEqual(rows);
  });
});
