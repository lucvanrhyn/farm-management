import { getPrismaForFarm } from "@/lib/farm-prisma";
import {
  getFinancialKPIs,
  getCostPerCamp,
  getProfitabilityByCategory,
} from "@/lib/server/financial-analytics";
import dynamic from "next/dynamic";

const CampCostAnalysis = dynamic(
  () => import("@/components/admin/CampCostAnalysis"),
  { loading: () => <div className="h-48 animate-pulse bg-gray-100 rounded-lg" /> },
);
const CategoryProfitability = dynamic(
  () => import("@/components/admin/CategoryProfitability"),
  { loading: () => <div className="h-48 animate-pulse bg-gray-100 rounded-lg" /> },
);

function kpiColor(value: number, positiveGood = true): string {
  if (value === 0) return "var(--ft-subtle)";
  return (positiveGood ? value > 0 : value < 0) ? "var(--ft-good)" : "var(--ft-poor)";
}

export default async function FinancialKPISection({
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

  const dateRange = from && to ? { from, to } : undefined;

  const [kpis, campCosts, categoryProfit] = await Promise.all([
    getFinancialKPIs(prisma, farmSlug, dateRange),
    getCostPerCamp(prisma, farmSlug, dateRange),
    getProfitabilityByCategory(prisma, farmSlug, dateRange),
  ]);

  const fmt = (n: number) =>
    `R ${Math.round(Math.abs(n)).toLocaleString("en-ZA")}`;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div
        className="rounded-xl p-4 md:p-6"
        style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
      >
        <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--ft-text)" }}>
          Financial KPIs {dateRange ? `(${from} – ${to})` : "(All Time)"}
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
              color: "var(--ft-good)",
            },
            {
              label: "Total Expense",
              value: fmt(kpis.totalExpense),
              color: "var(--ft-poor)",
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-lg p-3"
              style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)" }}
            >
              <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>{label}</p>
              <p className="text-lg font-bold font-mono" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Camp Costs section */}
      <div
        className="rounded-xl p-4 md:p-6"
        style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
      >
        <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--ft-text)" }}>
          Camp Costs
        </h2>
        <CampCostAnalysis data={campCosts} />
      </div>

      {/* Category Profitability section */}
      <div
        className="rounded-xl p-4 md:p-6"
        style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
      >
        <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--ft-text)" }}>
          Profitability by Animal Category
        </h2>
        <CategoryProfitability data={categoryProfit} farmSlug={farmSlug} from={from} to={to} />
      </div>
    </div>
  );
}
