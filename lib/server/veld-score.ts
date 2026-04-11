import type { PrismaClient } from '@prisma/client';
import {
  calcGrazingCapacity,
  calcTrendSlope,
  type BiomeType,
  type TrendPoint,
} from '@/lib/calculators/veld-score';

export interface CampVeldSummary {
  readonly campId: string;
  readonly latestScore: number | null;
  readonly latestDate: string | null;
  readonly assessor: string | null;
  readonly haPerLsu: number | null;
  readonly trendSlope: number; // points/month, 12-month rolling
  readonly assessmentCount: number;
  readonly daysSinceAssessment: number | null;
}

export interface FarmVeldSummary {
  readonly averageScore: number | null;
  readonly campsAssessed: number;
  readonly campsTotal: number;
  readonly critical: CampVeldSummary[]; // score < 3
  readonly declining: CampVeldSummary[]; // trendSlope < -0.1
  readonly overdue: CampVeldSummary[]; // >180d since assessment
  readonly byCamp: CampVeldSummary[];
}

const DECLINE_THRESHOLD = -0.1;
const CRITICAL_SCORE = 3;
const OVERDUE_DAYS = 180;

function daysSince(dateStr: string, now: Date): number {
  const d = new Date(dateStr + 'T00:00:00Z').getTime();
  return Math.floor((now.getTime() - d) / (1000 * 60 * 60 * 24));
}

/** Latest single assessment per camp (map keyed by campId). */
export async function getLatestByCamp(
  prisma: PrismaClient,
): Promise<Map<string, { score: number; date: string; assessor: string; haPerLsu: number | null }>> {
  const rows = await prisma.veldAssessment.findMany({
    orderBy: { assessmentDate: 'desc' },
    select: {
      campId: true,
      assessmentDate: true,
      assessor: true,
      veldScore: true,
      haPerLsu: true,
    },
  });
  const latest = new Map<string, { score: number; date: string; assessor: string; haPerLsu: number | null }>();
  for (const r of rows) {
    if (!latest.has(r.campId)) {
      latest.set(r.campId, {
        score: r.veldScore,
        date: r.assessmentDate,
        assessor: r.assessor,
        haPerLsu: r.haPerLsu,
      });
    }
  }
  return latest;
}

/** Returns rolling 12-month trend points for one camp, oldest → newest. */
export async function getTrendByCamp(
  prisma: PrismaClient,
  campId: string,
  now: Date = new Date(),
): Promise<TrendPoint[]> {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 12);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const rows = await prisma.veldAssessment.findMany({
    where: { campId, assessmentDate: { gte: cutoffStr } },
    orderBy: { assessmentDate: 'asc' },
    select: { assessmentDate: true, veldScore: true },
  });
  return rows.map((r) => ({ date: r.assessmentDate, score: r.veldScore }));
}

/** Aggregates everything a dashboard/map/page needs about farm-wide veld state. */
export async function getFarmSummary(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<FarmVeldSummary> {
  const [camps, settings, allRows] = await Promise.all([
    prisma.camp.findMany({ select: { campId: true } }),
    prisma.farmSettings.findUnique({ where: { id: 'singleton' }, select: { biomeType: true } }),
    prisma.veldAssessment.findMany({
      orderBy: { assessmentDate: 'asc' },
      select: { campId: true, assessmentDate: true, veldScore: true, assessor: true, haPerLsu: true },
    }),
  ]);

  const biome = (settings?.biomeType ?? 'mixedveld') as BiomeType;
  const byCampRows = new Map<string, typeof allRows>();
  for (const r of allRows) {
    if (!byCampRows.has(r.campId)) byCampRows.set(r.campId, []);
    byCampRows.get(r.campId)!.push(r);
  }

  const byCamp: CampVeldSummary[] = camps.map(({ campId }) => {
    const rows = byCampRows.get(campId) ?? [];
    if (rows.length === 0) {
      return {
        campId,
        latestScore: null,
        latestDate: null,
        assessor: null,
        haPerLsu: null,
        trendSlope: 0,
        assessmentCount: 0,
        daysSinceAssessment: null,
      };
    }
    const latest = rows[rows.length - 1];
    const trendPoints: TrendPoint[] = rows.map((r) => ({ date: r.assessmentDate, score: r.veldScore }));
    const slope = calcTrendSlope(trendPoints);
    const haPerLsu =
      latest.haPerLsu ?? calcGrazingCapacity(biome, latest.veldScore).haPerLsu;
    return {
      campId,
      latestScore: latest.veldScore,
      latestDate: latest.assessmentDate,
      assessor: latest.assessor,
      haPerLsu,
      trendSlope: slope,
      assessmentCount: rows.length,
      daysSinceAssessment: daysSince(latest.assessmentDate, now),
    };
  });

  const assessed = byCamp.filter((c) => c.latestScore != null);
  const averageScore =
    assessed.length === 0
      ? null
      : Number((assessed.reduce((a, b) => a + (b.latestScore ?? 0), 0) / assessed.length).toFixed(1));

  return {
    averageScore,
    campsAssessed: assessed.length,
    campsTotal: camps.length,
    critical: byCamp.filter((c) => c.latestScore != null && c.latestScore < CRITICAL_SCORE),
    declining: byCamp.filter((c) => c.trendSlope < DECLINE_THRESHOLD && c.assessmentCount >= 2),
    overdue: byCamp.filter(
      (c) => c.latestScore == null || (c.daysSinceAssessment ?? 0) > OVERDUE_DAYS,
    ),
    byCamp,
  };
}
