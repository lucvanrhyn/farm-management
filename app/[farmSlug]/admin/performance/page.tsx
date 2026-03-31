import { Suspense } from "react";
import PerformanceTable from "@/components/admin/PerformanceTable";
import ExportButton from "@/components/admin/ExportButton";
import DateRangePicker from "@/components/admin/DateRangePicker";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { calcDaysGrazingRemaining } from "@/lib/server/analytics";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const LSU_FACTOR: Record<string, number> = {
  Cow: 1.0, Bull: 1.2, Heifer: 0.7, Calf: 0.3, Ox: 1.1,
};

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const { farmSlug } = await params;
  const { from, to } = searchParams ? await searchParams : {};
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found</p>;

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;

  // Build shared date filter clauses
  const observedAtFilter: Record<string, unknown> = {};
  if (fromDate) observedAtFilter.gte = fromDate;
  if (toDate) observedAtFilter.lte = toDate;
  const hasDateFilter = fromDate || toDate;

  // ── Batch-fetch ALL data in 3 parallel queries ────────────────────────────
  const [camps, animalsByCategory, allConditions, allCoverReadings] = await Promise.all([
    prisma.camp.findMany({ orderBy: { campId: "asc" } }),

    // All active animals grouped by camp + category
    prisma.animal.groupBy({
      by: ["currentCamp", "category"],
      where: { status: "Active" },
      _count: { id: true },
    }),

    // Latest camp_condition observation per camp (within date range if provided)
    prisma.observation.findMany({
      where: {
        type: "camp_condition",
        ...(hasDateFilter && { observedAt: observedAtFilter }),
      },
      select: { campId: true, observedAt: true, details: true },
      orderBy: { observedAt: "desc" },
    }),

    // Latest cover reading per camp (within date range if provided)
    prisma.campCoverReading.findMany({
      where: hasDateFilter ? { recordedAt: observedAtFilter } : undefined,
      orderBy: { recordedAt: "desc" },
    }),
  ]);

  // ── Join in JS ─────────────────────────────────────────────────────────────

  // Index animals by campId
  const animalsByCamp = new Map<string, Array<{ category: string; count: number }>>();
  for (const row of animalsByCategory) {
    const campId = row.currentCamp ?? "";
    if (!campId) continue;
    const existing = animalsByCamp.get(campId) ?? [];
    animalsByCamp.set(campId, [...existing, { category: row.category, count: row._count.id }]);
  }

  // Index latest condition per camp (results are desc by observedAt — first wins)
  const latestConditionByCamp = new Map<string, typeof allConditions[number]>();
  for (const obs of allConditions) {
    if (obs.campId && !latestConditionByCamp.has(obs.campId)) {
      latestConditionByCamp.set(obs.campId, obs);
    }
  }

  // Index latest cover reading per camp (results are desc by recordedAt — first wins)
  const latestCoverByCamp = new Map<string, typeof allCoverReadings[number]>();
  for (const reading of allCoverReadings) {
    if (!latestCoverByCamp.has(reading.campId)) {
      latestCoverByCamp.set(reading.campId, reading);
    }
  }

  // Assemble per-camp rows
  const rows = camps.map((camp) => {
    const campAnimals = animalsByCamp.get(camp.campId) ?? [];
    const latestCondition = latestConditionByCamp.get(camp.campId) ?? null;
    const latestCover = latestCoverByCamp.get(camp.campId) ?? null;

    const animalCount = campAnimals.reduce((sum, r) => sum + r.count, 0);
    const totalLSU = campAnimals.reduce(
      (sum, r) => sum + r.count * (LSU_FACTOR[r.category] ?? 1.0),
      0,
    );
    const density =
      camp.sizeHectares && camp.sizeHectares > 0
        ? (totalLSU / camp.sizeHectares).toFixed(2)
        : null;

    let details: Record<string, string> | null = null;
    if (latestCondition?.details) {
      try {
        details = JSON.parse(latestCondition.details) as Record<string, string>;
      } catch {
        // malformed details — leave as null
      }
    }

    const daysGrazingRemaining =
      latestCover && camp.sizeHectares && camp.sizeHectares > 0
        ? calcDaysGrazingRemaining(
            latestCover.kgDmPerHa,
            latestCover.useFactor,
            camp.sizeHectares,
            campAnimals,
          )
        : null;

    return {
      campId: camp.campId,
      campName: camp.campName,
      sizeHectares: camp.sizeHectares,
      animalCount,
      stockingDensity: density,
      grazingQuality: details?.grazing ?? null,
      fenceStatus: details?.fence ?? null,
      lastInspection: latestCondition?.observedAt
        ? new Date(latestCondition.observedAt).toISOString().split("T")[0]
        : null,
      coverCategory: latestCover?.coverCategory ?? null,
      daysGrazingRemaining:
        daysGrazingRemaining !== null ? Math.round(daysGrazingRemaining) : null,
    };
  });

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#1C1815]">Performance</h1>
          <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
            {camps.length} camps · stocking density, grazing, pasture cover
          </p>
        </div>
        <ExportButton farmSlug={farmSlug} exportType="camps" label="Export" />
      </div>
      <div className="mb-4">
        <Suspense fallback={<div className="h-9" />}>
          <DateRangePicker defaultDays={90} />
        </Suspense>
      </div>
      <PerformanceTable rows={rows} farmSlug={farmSlug} />
    </div>
  );
}
