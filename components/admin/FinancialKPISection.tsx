import { getPrismaForFarm } from "@/lib/farm-prisma";
import {
  getFinancialKPIs,
  getCostPerCamp,
  getProfitabilityByCategory,
} from "@/lib/server/financial-analytics";
import CampCostAnalysis from "@/components/admin/CampCostAnalysis";
import CategoryProfitability from "@/components/admin/CategoryProfitability";

function kpiColor(value: number, positiveGood = true): string {
  if (value === 0) return "#9C8E7A";
  return positiveGood === value > 0 ? "#4A7C59" : "#C0574C";
}

export default async function FinancialKPISection({
  farmSlug,
}: {
  farmSlug: string;
}) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return null;

  const [kpis, campCosts, categoryProfit] = await Promise.all([
    getFinancialKPIs(prisma, farmSlug),
    getCostPerCamp(prisma, farmSlug),
    getProfitabilityByCategory(prisma, farmSlug),
  ]);

  const fmt = (n: number) =>
    `R ${Math.round(Math.abs(n)).toLocaleString("en-ZA")}`;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div
        className="rounded-xl p-4 md:p-6"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <h2 className="text-sm font-semibold mb-4" style={{ color: "#1C1815" }}>
          Financial KPIs (All Time)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {[
            {
              label: "Gross Margin %",
              value: `${kpis.grossMarginPercent.toFixed(1)}%`,
              color: kpiColor(kpis.grossMarginPercent, true),
            },
            {
              label: "Revenue / Head",
              value: fmt(kpis.revenuePerHead),
              color: kpiColor(kpis.revenuePerHead, true),
            },
            {
              label: "OpEx Ratio",
              value: `${kpis.opexRatio.toFixed(1)}%`,
              color: kpiColor(kpis.opexRatio, false),
            },
            {
              label: "Total Income",
              value: fmt(kpis.totalIncome),
              color: "#4A7C59",
            },
            {
              label: "Total Expense",
              value: fmt(kpis.totalExpense),
              color: "#C0574C",
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-lg p-3"
              style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
            >
              <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>{label}</p>
              <p className="text-lg font-bold font-mono" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Camp Costs section */}
      <div
        className="rounded-xl p-4 md:p-6"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <h2 className="text-sm font-semibold mb-4" style={{ color: "#1C1815" }}>
          Camp Costs
        </h2>
        <CampCostAnalysis data={campCosts} />
      </div>

      {/* Category Profitability section */}
      <div
        className="rounded-xl p-4 md:p-6"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <h2 className="text-sm font-semibold mb-4" style={{ color: "#1C1815" }}>
          Profitability by Animal Category
        </h2>
        <CategoryProfitability data={categoryProfit} />
      </div>
    </div>
  );
}
