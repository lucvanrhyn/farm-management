export const dynamic = "force-dynamic";
import DashboardClient from "@/components/dashboard/DashboardClient";
import { getCachedDashboardData } from "@/lib/server/cached";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { scoped } from "@/lib/server/species-scoped-prisma";
import type { Camp } from "@/lib/types";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  // Cached data layer: 8 dashboard queries packaged behind unstable_cache
  // (30 s TTL, tagged by animals + camps + observations — any mutation
  // clears the entry). The cache key is per-farm (not per-mode), so the
  // `camps` field returned here is the cross-species list.
  const data = await getCachedDashboardData(farmSlug);

  // Wave 233: filter the camps prop by the active FarmMode so the dashboard
  // map only renders camps belonging to the current species (PRD #222 /
  // issue #224). The cache cannot key per-mode without an invasive
  // refactor, so we issue one additional species-scoped read through the
  // facade and override `data.camps`. DashboardClient calls
  // `router.refresh()` on mode flips, so this server fetch re-runs with
  // the new cookie — no full page reload.
  const mode = await getFarmMode(farmSlug);
  const prisma = await getPrismaForFarm(farmSlug);
  let speciesCamps: Camp[] = data.camps;
  if (prisma) {
    const scopedCamps = await scoped(prisma, mode).camp.findMany({
      orderBy: { campName: "asc" },
    });
    speciesCamps = scopedCamps.map((c) => ({
      camp_id: c.campId,
      camp_name: c.campName,
      size_hectares: c.sizeHectares ?? undefined,
      water_source: c.waterSource ?? undefined,
      geojson: c.geojson ?? undefined,
      color: c.color ?? undefined,
    }));
  }

  return (
    <DashboardClient
      farmSlug={farmSlug}
      totalAnimals={data.totalAll}
      totalBySpecies={data.totalBySpecies}
      campAnimalCounts={data.campAnimalCounts}
      campCountsBySpecies={data.campCountsBySpecies}
      camps={speciesCamps}
      latitude={data.latitude}
      longitude={data.longitude}
      censusCountByCamp={data.censusCountByCamp}
      rotationByCampId={data.rotationByCampId}
      veldScoreByCamp={data.veldScoreByCamp}
      feedOnOfferKgDmPerHaByCamp={data.feedOnOfferKgDmPerHaByCamp}
    />
  );
}
