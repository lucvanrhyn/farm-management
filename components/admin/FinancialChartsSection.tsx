import { getPrismaForFarm } from "@/lib/farm-prisma";
import { fetchCampAnalyticsData, fetchFinancialAnalyticsData } from "@/lib/server/chart-data";
import FinancialChartsClient from "@/components/admin/FinancialChartsClient";

export default async function FinancialChartsSection({
  farmSlug,
  from,
  to,
}: {
  farmSlug: string;
  from?: string;
  to?: string;
}) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return null;

  const campAnalytics = await fetchCampAnalyticsData(prisma);

  const finansieleData = await fetchFinancialAnalyticsData(
    prisma,
    campAnalytics.prismaCamps,
    campAnalytics.headcount,
    from,
    to,
  );

  return <FinancialChartsClient data={finansieleData} />;
}
