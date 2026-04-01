import { getPrismaForFarm } from "@/lib/farm-prisma";
import { fetchCampAnalyticsData } from "@/lib/server/chart-data";
import CampAnalyticsClient from "@/components/admin/CampAnalyticsClient";
import type { Camp } from "@/lib/types";

export default async function CampAnalyticsSection({
  farmSlug,
}: {
  farmSlug: string;
}) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return null;

  const analyticsData = await fetchCampAnalyticsData(prisma);

  const camps: Camp[] = analyticsData.prismaCamps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
    size_hectares: c.sizeHectares ?? undefined,
    water_source: c.waterSource ?? undefined,
  }));

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

  return <CampAnalyticsClient data={data} camps={camps} />;
}
