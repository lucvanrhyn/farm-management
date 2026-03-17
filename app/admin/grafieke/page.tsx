import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import AdminNav from "@/components/admin/AdminNav";
import GrafiekeClient from "@/components/admin/GrafiekeClient";
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
  ] = await Promise.all([
    getCampConditionTrend(30),
    getHealthIssuesByCamp(30),
    getHeadcountByCamp(),
    getInspectionHeatmap(30),
    getAnimalMovements(30),
    getCalvingTrend(12),
    getDeathsAndSales(12),
    getWithdrawalTracker(),
  ]);

  return (
    <div className="flex min-h-screen bg-stone-50">
      <AdminNav active="/admin/grafieke" />
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-stone-800">Charts</h1>
          <p className="text-stone-500 text-sm mt-1">
            30-day overview · Farm Management
          </p>
        </div>
        <GrafiekeClient
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
