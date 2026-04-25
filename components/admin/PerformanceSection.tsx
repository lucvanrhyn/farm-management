import { Suspense } from "react";
import PerformanceTable from "@/components/admin/PerformanceTable";
import ExportButton from "@/components/admin/ExportButton";
import DateRangePicker from "@/components/admin/DateRangePicker";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { calcDaysGrazingRemaining } from "@/lib/server/analytics";
import { getMergedLsuValues } from "@/lib/species/registry";
import type { PerfRow } from "@/components/admin/PerformanceTable";

export default async function PerformanceSection({
  farmSlug,
  from,
  to,
}: {
  farmSlug: string;
  from?: string;
  to?: string;
}) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p className="text-sm text-red-500">Farm not found.</p>;

  const LSU_VALUES = getMergedLsuValues();

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;

  const observedAtFilter: Record<string, unknown> = {};
  if (fromDate) observedAtFilter.gte = fromDate;
  if (toDate) observedAtFilter.lte = toDate;
  const hasDateFilter = fromDate || toDate;

  const [camps, animalsByCategory, allConditions, allCoverReadings] = await Promise.all([
    prisma.camp.findMany({ orderBy: { campId: "asc" } }),
    // cross-species by design: per-camp performance groups by species + category
    // explicitly so the merged-LSU table can weight each bucket correctly.
    prisma.animal.groupBy({
      by: ["currentCamp", "species", "category"],
      where: { status: "Active" },
      _count: { id: true },
    }),
    prisma.observation.findMany({
      where: {
        type: "camp_condition",
        ...(hasDateFilter && { observedAt: observedAtFilter }),
      },
      select: { campId: true, observedAt: true, details: true },
      orderBy: { observedAt: "desc" },
    }),
    prisma.campCoverReading.findMany({
      where: hasDateFilter ? { recordedAt: observedAtFilter } : undefined,
      orderBy: { recordedAt: "desc" },
    }),
  ]);

  const animalsByCamp = new Map<string, Array<{ category: string; count: number }>>();
  for (const row of animalsByCategory) {
    const campId = row.currentCamp ?? "";
    if (!campId) continue;
    const existing = animalsByCamp.get(campId) ?? [];
    animalsByCamp.set(campId, [...existing, { category: row.category, count: row._count.id }]);
  }

  const latestConditionByCamp = new Map<string, typeof allConditions[number]>();
  for (const obs of allConditions) {
    if (obs.campId && !latestConditionByCamp.has(obs.campId)) {
      latestConditionByCamp.set(obs.campId, obs);
    }
  }

  const latestCoverByCamp = new Map<string, typeof allCoverReadings[number]>();
  for (const reading of allCoverReadings) {
    if (!latestCoverByCamp.has(reading.campId)) {
      latestCoverByCamp.set(reading.campId, reading);
    }
  }

  const rows: PerfRow[] = camps.map((camp) => {
    const campAnimals = animalsByCamp.get(camp.campId) ?? [];
    const latestCondition = latestConditionByCamp.get(camp.campId) ?? null;
    const latestCover = latestCoverByCamp.get(camp.campId) ?? null;

    const animalCount = campAnimals.reduce((sum, r) => sum + r.count, 0);
    const totalLSU = campAnimals.reduce(
      (sum, r) => sum + r.count * (LSU_VALUES[r.category] ?? 0),
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
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="text-xs font-mono mt-1" style={{ color: "#9C8E7A" }}>
          {camps.length} camps · stocking density, grazing, pasture cover
        </p>
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
