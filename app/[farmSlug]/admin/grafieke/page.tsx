import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import GrafiekeClient from "@/components/admin/GrafiekeClient";
import type { FinancialMonthPoint, HerdCategoryCount, CampCoverRow } from "@/components/admin/GrafiekeClient";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { Camp } from "@/lib/types";
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

export const dynamic = "force-dynamic";

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthsAgoString(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 7); // YYYY-MM
}

function toMonthString(dateStr: string): string {
  return dateStr.slice(0, 7); // works for ISO "YYYY-MM-DD..." strings
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function GrafiekePage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found.</p>;

  const cutoffMonth = monthsAgoString(6);

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
    rawTransactions,
    activeAnimals,
    coverReadings,
  ] = await Promise.all([
    getCampConditionTrend(prisma, 30),
    getHealthIssuesByCamp(prisma, 30),
    getHeadcountByCamp(prisma),
    getInspectionHeatmap(prisma, 30),
    getAnimalMovements(prisma, 30),
    getCalvingTrend(prisma, 12),
    getDeathsAndSales(prisma, 12),
    getWithdrawalTracker(prisma),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
    // Financial: last 6 months
    prisma.transaction.findMany({
      where: { date: { gte: `${cutoffMonth}-01` } },
      select: { type: true, amount: true, date: true },
    }),
    // Herd composition: active animals
    prisma.animal.groupBy({
      by: ["category"],
      where: { status: "Active" },
      _count: { id: true },
    }),
    // Camp cover readings: latest per camp
    prisma.campCoverReading.findMany({
      orderBy: { recordedAt: "desc" },
    }),
  ]);

  // ── Map camps ──────────────────────────────────────────────────────────────
  const camps: Camp[] = prismaCamps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
    size_hectares: c.sizeHectares ?? undefined,
    water_source: c.waterSource ?? undefined,
  }));

  // ── Financial trend (last 6 months) ───────────────────────────────────────
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

  // ── Herd composition ───────────────────────────────────────────────────────
  const herdComposition: HerdCategoryCount[] = activeAnimals.map((r) => ({
    category: r.category,
    count: r._count.id,
  }));

  // ── Camp cover with days grazing remaining ─────────────────────────────────
  // Use only the latest reading per campId
  const latestCoverByCamp = new Map<string, typeof coverReadings[number]>();
  for (const r of coverReadings) {
    if (!latestCoverByCamp.has(r.campId)) {
      latestCoverByCamp.set(r.campId, r);
    }
  }

  // Build animalsByCategory per camp from headcount data
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
      animalsByCategory
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

  // Sort by days remaining ascending (nulls last)
  campCover.sort((a, b) => {
    if (a.daysGrazingRemaining === null && b.daysGrazingRemaining === null) return 0;
    if (a.daysGrazingRemaining === null) return 1;
    if (b.daysGrazingRemaining === null) return -1;
    return a.daysGrazingRemaining - b.daysGrazingRemaining;
  });

  return (
    <div className="min-w-0 p-4 md:p-8" style={{ background: "#1A1510" }}>
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "#F0DEB8" }}>Charts</h1>
          <p className="text-sm mt-1" style={{ color: "#9C8473" }}>
            Analytics overview · Farm Management
          </p>
        </div>
        <GrafiekeClient
          camps={camps}
          data={{
            conditionTrend,
            healthByCamp,
            headcount,
            heatmap,
            movements,
            calvings,
            attrition,
            withdrawals,
          }}
          finansieleData={{
            financialTrend,
            herdComposition,
            campCover,
          }}
        />
    </div>
  );
}
