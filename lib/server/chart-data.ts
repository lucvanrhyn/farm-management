/**
 * Shared chart data types and fetching logic extracted from the old grafieke page.
 * Used by camps, animals, and finansies pages to embed analytics sections.
 */

import type { PrismaClient } from "@prisma/client";
import {
  getCampConditionTrend,
  getHealthIssuesByCamp,
  getHeadcountByCamp,
  getInspectionHeatmap,
  getAnimalMovements,
  getCalvingTrend,
  getDeathsAndSales,
  getWithdrawalTracker,
  calcDaysGrazingRemaining,
} from "@/lib/server/analytics";
import { getHerdAdgTrend } from "@/lib/server/weight-analytics";

// ── Re-exported types (formerly in GrafiekeClient) ────────────────────────────

export interface FinancialMonthPoint {
  month: string;   // YYYY-MM
  income: number;
  expense: number;
}

export interface HerdCategoryCount {
  category: string;
  count: number;
}

export interface CampCoverRow {
  campId: string;
  campName: string;
  coverCategory: string;
  kgDmPerHa: number;
  recordedAt: string;
  daysGrazingRemaining: number | null;
}

export interface FinansieleData {
  financialTrend: FinancialMonthPoint[];
  herdComposition: HerdCategoryCount[];
  campCover: CampCoverRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthsAgoString(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 7); // YYYY-MM
}

function toMonthString(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function buildLast6MonthKeys(): string[] {
  const result: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    result.push(d.toISOString().slice(0, 7));
  }
  return result;
}

// ── Camp + Animal analytics data ──────────────────────────────────────────────

export async function fetchCampAnalyticsData(prisma: PrismaClient, lookbackDays = 365) {
  const lookbackMonths = Math.max(1, Math.round(lookbackDays / 30));

  const [
    conditionTrend,
    healthByCamp,
    headcount,
    heatmap,
    movements,
    calvings,
    attrition,
    withdrawals,
    prismaCamps,
  ] = await Promise.all([
    getCampConditionTrend(prisma, lookbackDays),
    getHealthIssuesByCamp(prisma, lookbackDays),
    getHeadcountByCamp(prisma),
    getInspectionHeatmap(prisma, lookbackDays),
    getAnimalMovements(prisma, lookbackDays),
    getCalvingTrend(prisma, lookbackMonths),
    getDeathsAndSales(prisma, lookbackMonths),
    getWithdrawalTracker(prisma),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
  ]);

  const herdAdgTrend = await getHerdAdgTrend(
    prisma,
    prismaCamps.map((c) => ({ campId: c.campId, campName: c.campName })),
    lookbackDays,
  );

  return {
    conditionTrend,
    healthByCamp,
    headcount,
    heatmap,
    movements,
    calvings,
    attrition,
    withdrawals,
    herdAdgTrend,
    prismaCamps,
  };
}

// ── Financial analytics data ──────────────────────────────────────────────────

export async function fetchFinancialAnalyticsData(
  prisma: PrismaClient,
  prismaCamps: Array<{ campId: string; campName: string; sizeHectares: number | null }>,
  headcount: Array<{ campId: string; category: string; count: number }>,
): Promise<FinansieleData> {
  const cutoffMonth = monthsAgoString(6);

  const [rawTransactions, activeAnimals, coverReadings] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: { gte: `${cutoffMonth}-01` } },
      select: { type: true, amount: true, date: true },
    }),
    prisma.animal.groupBy({
      by: ["category"],
      where: { status: "Active" },
      _count: { id: true },
    }),
    prisma.campCoverReading.findMany({
      orderBy: { recordedAt: "desc" },
    }),
  ]);

  // Financial trend
  const monthKeys = buildLast6MonthKeys();
  const financialMap = new Map<string, { income: number; expense: number }>();
  for (const mk of monthKeys) financialMap.set(mk, { income: 0, expense: 0 });

  for (const tx of rawTransactions) {
    const mk = toMonthString(tx.date);
    if (!financialMap.has(mk)) continue;
    const entry = financialMap.get(mk)!;
    if (tx.type === "income") {
      financialMap.set(mk, { ...entry, income: entry.income + tx.amount });
    } else {
      financialMap.set(mk, { ...entry, expense: entry.expense + tx.amount });
    }
  }

  const financialTrend: FinancialMonthPoint[] = monthKeys.map((mk) => {
    const entry = financialMap.get(mk) ?? { income: 0, expense: 0 };
    return { month: mk, income: entry.income, expense: entry.expense };
  });

  // Herd composition
  const herdComposition: HerdCategoryCount[] = activeAnimals.map((r) => ({
    category: r.category,
    count: r._count.id,
  }));

  // Camp cover
  const latestCoverByCamp = new Map<string, typeof coverReadings[number]>();
  for (const r of coverReadings) {
    if (!latestCoverByCamp.has(r.campId)) {
      latestCoverByCamp.set(r.campId, r);
    }
  }

  const animalsByCampCategory = new Map<string, Array<{ category: string; count: number }>>();
  for (const row of headcount) {
    const existing = animalsByCampCategory.get(row.campId) ?? [];
    animalsByCampCategory.set(row.campId, [...existing, { category: row.category, count: row.count }]);
  }

  const campNameById = new Map(prismaCamps.map((c) => [c.campId, c.campName]));
  const campSizeById = new Map(prismaCamps.map((c) => [c.campId, c.sizeHectares ?? 0]));

  const campCover: CampCoverRow[] = Array.from(latestCoverByCamp.values()).map((r) => {
    const sizeHectares = campSizeById.get(r.campId) ?? 0;
    const animalsByCategory = animalsByCampCategory.get(r.campId) ?? [];
    const daysGrazingRemaining = calcDaysGrazingRemaining(
      r.kgDmPerHa,
      r.useFactor,
      sizeHectares,
      animalsByCategory,
    );
    return {
      campId: r.campId,
      campName: campNameById.get(r.campId) ?? r.campId,
      coverCategory: r.coverCategory,
      kgDmPerHa: r.kgDmPerHa,
      recordedAt: r.recordedAt,
      daysGrazingRemaining,
    };
  });

  campCover.sort((a, b) => {
    if (a.daysGrazingRemaining === null && b.daysGrazingRemaining === null) return 0;
    if (a.daysGrazingRemaining === null) return 1;
    if (b.daysGrazingRemaining === null) return -1;
    return a.daysGrazingRemaining - b.daysGrazingRemaining;
  });

  return { financialTrend, herdComposition, campCover };
}
