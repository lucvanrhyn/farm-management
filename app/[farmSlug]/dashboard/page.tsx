import DashboardClient from "@/components/dashboard/DashboardClient";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getCensusPopulationByCamp } from "@/lib/species/game/analytics";
import { getRotationStatusByCamp } from "@/lib/server/rotation-engine";
import { getLatestByCamp } from "@/lib/server/veld-score";
import type { Camp } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p className="p-8 text-red-500">Farm not found.</p>;

  const [totalAnimals, animalGroupsBySpecies, prismaCamps, farmSettings, censusPopByCamp, rotationPayload, veldLatestByCamp] = await Promise.all([
    prisma.animal.groupBy({
      by: ["species"],
      where: { status: "Active" },
      _count: { _all: true },
    }),
    prisma.animal.groupBy({
      by: ["species", "currentCamp"],
      where: { status: "Active" },
      _count: { _all: true },
    }),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
    prisma.farmSettings.findFirst({ select: { latitude: true, longitude: true } }),
    getCensusPopulationByCamp(prisma),
    getRotationStatusByCamp(prisma),
    getLatestByCamp(prisma),
  ]);

  // Build per-species total counts: { cattle: 120, sheep: 80, ... }
  const totalBySpecies: Record<string, number> = {};
  let totalAll = 0;
  for (const g of totalAnimals) {
    const sp = g.species || "cattle";
    totalBySpecies[sp] = g._count._all;
    totalAll += g._count._all;
  }

  // Build per-species camp counts: { cattle: { camp1: 10 }, sheep: { camp1: 5 }, ... }
  const campCountsBySpecies: Record<string, Record<string, number>> = {};
  const campAnimalCounts: Record<string, number> = {};
  for (const g of animalGroupsBySpecies) {
    const sp = g.species || "cattle";
    if (!campCountsBySpecies[sp]) campCountsBySpecies[sp] = {};
    campCountsBySpecies[sp][g.currentCamp] = g._count._all;
    // Also keep a combined count for fallback
    campAnimalCounts[g.currentCamp] = (campAnimalCounts[g.currentCamp] ?? 0) + g._count._all;
  }

  const censusCountByCamp: Record<string, number> = {};
  for (const row of censusPopByCamp) {
    censusCountByCamp[row.campId] = row.totalPopulation;
  }

  const camps: Camp[] = prismaCamps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
    size_hectares: c.sizeHectares ?? undefined,
    water_source: c.waterSource ?? undefined,
    geojson: c.geojson ?? undefined,
    color: c.color ?? undefined,
  }));

  const rotationByCampId: Record<
    string,
    { status: "grazing" | "overstayed" | "resting" | "resting_ready" | "overdue_rest" | "unknown"; days: number | null }
  > = {};
  for (const c of rotationPayload.camps) {
    rotationByCampId[c.campId] = {
      status: c.status,
      days: c.daysGrazed ?? c.daysRested ?? null,
    };
  }

  const veldScoreByCamp: Record<string, number> = {};
  for (const [campId, entry] of veldLatestByCamp.entries()) {
    veldScoreByCamp[campId] = entry.score;
  }

  return (
    <DashboardClient
      totalAnimals={totalAll}
      totalBySpecies={totalBySpecies}
      campAnimalCounts={campAnimalCounts}
      campCountsBySpecies={campCountsBySpecies}
      camps={camps}
      latitude={farmSettings?.latitude ?? null}
      longitude={farmSettings?.longitude ?? null}
      censusCountByCamp={censusCountByCamp}
      rotationByCampId={rotationByCampId}
      veldScoreByCamp={veldScoreByCamp}
    />
  );
}
