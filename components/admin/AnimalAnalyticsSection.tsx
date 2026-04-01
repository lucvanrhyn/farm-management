import { getPrismaForFarm } from "@/lib/farm-prisma";
import { fetchCampAnalyticsData } from "@/lib/server/chart-data";
import AnimalAnalyticsClient from "@/components/admin/AnimalAnalyticsClient";

export default async function AnimalAnalyticsSection({
  farmSlug,
}: {
  farmSlug: string;
}) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return null;

  const analyticsData = await fetchCampAnalyticsData(prisma);

  const data = {
    conditionTrend: analyticsData.conditionTrend,
    healthByCamp: analyticsData.healthByCamp,
    headcount: analyticsData.headcount,
    heatmap: analyticsData.heatmap,
    movements: analyticsData.movements,
    calvings: analyticsData.calvings,
    attrition: analyticsData.attrition,
    withdrawals: analyticsData.withdrawals,
    herdAdgTrend: analyticsData.herdAdgTrend,
  };

  return <AnimalAnalyticsClient data={data} />;
}
