import { getPrismaForFarm } from "@/lib/farm-prisma";
import { fetchCampAnalyticsData, fetchFinancialAnalyticsData } from "@/lib/server/chart-data";
import FinancialChartsClient from "@/components/admin/FinancialChartsClient";

export default async function FinancialChartsSection({
  farmSlug,
}: {
  farmSlug: string;
}) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return null;

  const campAnalytics = await fetchCampAnalyticsData(prisma);

  const finansieleData = await fetchFinancialAnalyticsData(
    prisma,
    campAnalytics.prismaCamps,
    campAnalytics.headcount,
  );

  return <FinancialChartsClient data={finansieleData} />;
}
