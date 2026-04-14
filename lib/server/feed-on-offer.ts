import type { PrismaClient } from '@prisma/client';
import {
  calcCampFeedOnOffer,
  calcFarmFeedOnOfferSummary,
  calcFeedOnOfferTrendSlope,
  type CampFeedOnOfferInput,
  type CampFeedOnOfferResult,
  type FarmFeedOnOfferSummary,
  type FeedOnOfferTrendPoint,
} from '@/lib/calculators/feed-on-offer';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LatestCover {
  readonly id: string;
  readonly kgDmPerHa: number;
  readonly useFactor: number;
  readonly coverCategory: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

export interface CampFeedOnOfferSummary {
  readonly campId: string;
  readonly campName: string;
  readonly sizeHectares: number | null;
  readonly latestReading: LatestCover | null;
  readonly feedOnOffer: CampFeedOnOfferResult;
  readonly trendSlope: number;
  readonly readingCount: number;
}

export interface FarmFeedOnOfferPayload {
  readonly summary: FarmFeedOnOfferSummary;
  readonly byCamp: readonly CampFeedOnOfferSummary[];
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
): Promise<FeedOnOfferTrendPoint[]> {
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

/** Aggregates everything needed for the Feed on Offer dashboard / tools page / alerts. */
export async function getFarmFeedOnOfferPayload(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<FarmFeedOnOfferPayload> {
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

  // Per-camp Feed on Offer metrics
  const byCamp: CampFeedOnOfferSummary[] = camps.map(({ campId, campName, sizeHectares }) => {
    const rows = byCampRows.get(campId) ?? [];
    const latest = rows.length > 0 ? rows[rows.length - 1] : null;

    const input: CampFeedOnOfferInput = {
      kgDmPerHa: latest?.kgDmPerHa ?? null,
      useFactor: latest?.useFactor ?? null,
      sizeHectares,
      recordedAt: latest?.recordedAt ?? null,
    };

    const feedOnOffer = calcCampFeedOnOffer(input, now);

    const trendPoints: FeedOnOfferTrendPoint[] = rows.map((r) => ({
      date: r.recordedAt.slice(0, 10),
      kgDmPerHa: r.kgDmPerHa,
    }));
    const trendSlope = calcFeedOnOfferTrendSlope(trendPoints);

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
      feedOnOffer,
      trendSlope,
      readingCount: rows.length,
    };
  });

  // Farm-wide summary from pure calculator
  const summary = calcFarmFeedOnOfferSummary(byCamp.map((c) => c.feedOnOffer));

  // Farm-wide monthly trend: average Feed on Offer across all camps per month
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
