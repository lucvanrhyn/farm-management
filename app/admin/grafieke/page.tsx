import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import AdminNav from "@/components/admin/AdminNav";
import GrafiekeClient from "@/components/admin/GrafiekeClient";
import { prisma } from "@/lib/prisma";
import type { Camp } from "@/lib/types";
import {
  getCampConditionTrend,
  getHealthIssuesByCamp,
  getHeadcountByCamp,
  getInspectionHeatmap,
  getAnimalMovements,
  getCalvingTrend,
  getDeathsAndSales,
  getWithdrawalTracker,
} from "@/lib/server/analytics";

export const dynamic = "force-dynamic";

export default async function GrafiekePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const [
    conditionTrend,
    healthByCamp,
    headcount,
    heatmap,
    movements,
    calvings,
    attrition,
    withdrawals,
    prismaCamps,
  ] = await Promise.all([
    getCampConditionTrend(30),
    getHealthIssuesByCamp(30),
    getHeadcountByCamp(),
    getInspectionHeatmap(30),
    getAnimalMovements(30),
    getCalvingTrend(12),
    getDeathsAndSales(12),
    getWithdrawalTracker(),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
  ]);

  const camps: Camp[] = prismaCamps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
    size_hectares: c.sizeHectares ?? undefined,
    water_source: c.waterSource ?? undefined,
  }));

  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav active="/admin/grafieke" />
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#1C1815]">Charts</h1>
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
            30-day overview · Farm Management
          </p>
        </div>
        <GrafiekeClient
          camps={camps}
          data={{
            conditionTrend,
            healthByCamp,
            headcount,
            heatmap,
            movements,
            calvings,
            attrition,
            withdrawals,
          }}
        />
      </main>
    </div>
  );
}
