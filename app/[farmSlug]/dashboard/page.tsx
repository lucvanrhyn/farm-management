export const dynamic = "force-dynamic";
import DashboardClient from "@/components/dashboard/DashboardClient";
import { getCachedDashboardData } from "@/lib/server/cached";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  // Cached data layer: 8 dashboard queries packaged behind unstable_cache
  // (30 s TTL, tagged by animals + camps + observations — any mutation
  // clears the entry).
  const data = await getCachedDashboardData(farmSlug);

  return (
    <DashboardClient
      totalAnimals={data.totalAll}
      totalBySpecies={data.totalBySpecies}
      campAnimalCounts={data.campAnimalCounts}
      campCountsBySpecies={data.campCountsBySpecies}
      camps={data.camps}
      latitude={data.latitude}
      longitude={data.longitude}
      censusCountByCamp={data.censusCountByCamp}
      rotationByCampId={data.rotationByCampId}
      veldScoreByCamp={data.veldScoreByCamp}
      feedOnOfferKgDmPerHaByCamp={data.feedOnOfferKgDmPerHaByCamp}
    />
  );
}
