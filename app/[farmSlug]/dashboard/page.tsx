export const dynamic = "force-dynamic";
import DashboardClient from "@/components/dashboard/DashboardClient";
import { getCachedDashboardData } from "@/lib/server/cached";
import { getFarmMode } from "@/lib/server/get-farm-mode";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  // Cached data layer: 8 dashboard queries packaged behind unstable_cache
  // (30 s TTL, tagged by animals + camps + observations — any mutation
  // clears the entry). The cache key is per-farm (not per-mode), so
  // `data.camps` is the cross-species list, with each entry carrying its
  // own `species` field (threaded through the DTO in Wave 233).
  const data = await getCachedDashboardData(farmSlug);

  // Wave 233: filter the camps prop by the active FarmMode so the dashboard
  // map only renders camps belonging to the current species (PRD #222 /
  // issue #224). In-memory filter from the cached cross-species list —
  // zero extra Prisma round-trips, and the dashboard page stays on its
  // Phase-F contract (all data flows through the cached helper, no raw
  // Prisma import here — enforced by __tests__/perf/cache-flag-removal).
  // DashboardClient calls `router.refresh()` when the mode cookie flips so
  // this filter re-runs without a full page reload.
  const mode = await getFarmMode(farmSlug);
  const speciesCamps = data.camps.filter((c) => c.species === mode);

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
