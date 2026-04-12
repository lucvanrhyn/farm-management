import type { PrismaClient } from '@prisma/client';
import {
  calcCampFoo,
  calcFarmFooSummary,
  calcFooTrendSlope,
  type CampFooInput,
  type CampFooResult,
  type FarmFooSummary,
  type FooTrendPoint,
} from '@/lib/calculators/foo';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LatestCover {
  readonly id: string;
  readonly kgDmPerHa: number;
  readonly useFactor: number;
  readonly coverCategory: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

export interface CampFooSummary {
  readonly campId: string;
  readonly campName: string;
  readonly sizeHectares: number | null;
  readonly latestReading: LatestCover | null;
  readonly foo: CampFooResult;
  readonly trendSlope: number;
  readonly readingCount: number;
}

export interface FarmFooPayload {
  readonly summary: FarmFooSummary;
  readonly byCamp: readonly CampFooSummary[];
  readonly trendData: readonly { date: string; avgKgDmPerHa: number }[];
}

// ── Server functions ──────────────────────────────────────────────────────────

/** Latest single cover reading per camp (map keyed by campId). */
export async function getLatestCoverByCamp(
  prisma: PrismaClient,
): Promise<Map<string, LatestCover>> {
  const rows = await prisma.campCoverReading.findMany({
    orderBy: { recordedAt: 'desc' },
    select: {
      id: true,
      campId: true,
      kgDmPerHa: true,
      useFactor: true,
      coverCategory: true,
      recordedAt: true,
      recordedBy: true,
    },
  });

  const latest = new Map<string, LatestCover>();
  for (const r of rows) {
    if (!latest.has(r.campId)) {
      latest.set(r.campId, {
        id: r.id,
        kgDmPerHa: r.kgDmPerHa,
        useFactor: r.useFactor,
        coverCategory: r.coverCategory,
        recordedAt: r.recordedAt,
        recordedBy: r.recordedBy,
      });
    }
  }
  return latest;
}

/** Rolling 12-month trend points for one camp, oldest → newest. */
export async function getCoverTrendByCamp(
  prisma: PrismaClient,
  campId: string,
  now: Date = new Date(),
): Promise<FooTrendPoint[]> {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 12);
  const cutoffStr = cutoff.toISOString();
  const rows = await prisma.campCoverReading.findMany({
    where: { campId, recordedAt: { gte: cutoffStr } },
    orderBy: { recordedAt: 'asc' },
    select: { recordedAt: true, kgDmPerHa: true },
  });
  return rows.map((r) => ({
    date: r.recordedAt.slice(0, 10),
    kgDmPerHa: r.kgDmPerHa,
  }));
}

/** Aggregates everything needed for the FOO dashboard / tools page / alerts. */
export async function getFarmFooPayload(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<FarmFooPayload> {
  const [camps, allReadings] = await Promise.all([
    prisma.camp.findMany({
      select: { campId: true, campName: true, sizeHectares: true },
    }),
    prisma.campCoverReading.findMany({
      orderBy: { recordedAt: 'asc' },
      select: {
        campId: true,
        id: true,
        kgDmPerHa: true,
        useFactor: true,
        coverCategory: true,
        recordedAt: true,
        recordedBy: true,
      },
    }),
  ]);

  // Group readings by camp
  const byCampRows = new Map<string, typeof allReadings>();
  for (const r of allReadings) {
    if (!byCampRows.has(r.campId)) byCampRows.set(r.campId, []);
    byCampRows.get(r.campId)!.push(r);
  }

  // Per-camp FOO metrics
  const byCamp: CampFooSummary[] = camps.map(({ campId, campName, sizeHectares }) => {
    const rows = byCampRows.get(campId) ?? [];
    const latest = rows.length > 0 ? rows[rows.length - 1] : null;

    const input: CampFooInput = {
      kgDmPerHa: latest?.kgDmPerHa ?? null,
      useFactor: latest?.useFactor ?? null,
      sizeHectares,
      recordedAt: latest?.recordedAt ?? null,
    };

    const foo = calcCampFoo(input, now);

    const trendPoints: FooTrendPoint[] = rows.map((r) => ({
      date: r.recordedAt.slice(0, 10),
      kgDmPerHa: r.kgDmPerHa,
    }));
    const trendSlope = calcFooTrendSlope(trendPoints);

    const latestReading: LatestCover | null = latest
      ? {
          id: latest.id,
          kgDmPerHa: latest.kgDmPerHa,
          useFactor: latest.useFactor,
          coverCategory: latest.coverCategory,
          recordedAt: latest.recordedAt,
          recordedBy: latest.recordedBy,
        }
      : null;

    return {
      campId,
      campName,
      sizeHectares,
      latestReading,
      foo,
      trendSlope,
      readingCount: rows.length,
    };
  });

  // Farm-wide summary from pure calculator
  const summary = calcFarmFooSummary(byCamp.map((c) => c.foo));

  // Farm-wide monthly trend: average FOO across all camps per month
  const monthlyMap = new Map<string, { sum: number; count: number }>();
  for (const r of allReadings) {
    const month = r.recordedAt.slice(0, 7); // YYYY-MM
    const entry = monthlyMap.get(month) ?? { sum: 0, count: 0 };
    entry.sum += r.kgDmPerHa;
    entry.count += 1;
    monthlyMap.set(month, entry);
  }
  const trendData = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sum, count }]) => ({
      date,
      avgKgDmPerHa: Math.round(sum / count),
    }));

  return { summary, byCamp, trendData };
}
