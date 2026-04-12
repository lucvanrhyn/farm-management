import { getPrismaForFarm } from "@/lib/farm-prisma";
import {
  getCogByCamp,
  getCogByAnimal,
  getCogSummary,
} from "@/lib/server/financial-analytics";
import { isCogScope, type CogScope } from "@/lib/calculators/cost-of-gain";
import CostOfGainTablesClient from "@/components/admin/cost-of-gain/CostOfGainTablesClient";

function fmtR(n: number): string {
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

function fmtCog(n: number | null): string {
  return n === null ? "—" : `R ${n.toFixed(2)}/kg`;
}

function fmtKg(n: number): string {
  return `${Math.round(n).toLocaleString("en-ZA")} kg`;
}

export default async function CostOfGainSection({
  farmSlug,
  from,
  to,
  cogScope,
}: {
  farmSlug: string;
  from?: string;
  to?: string;
  cogScope?: string;
}) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return null;

  const scope: CogScope = isCogScope(cogScope) ? cogScope : "all";

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : defaultFrom;
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : now;

  const [summary, byCamp, byAnimal] = await Promise.all([
    getCogSummary(prisma, fromDate, toDate, scope),
    getCogByCamp(prisma, fromDate, toDate, scope),
    getCogByAnimal(prisma, fromDate, toDate, scope, 50),
  ]);

  const periodLabel =
    from && to
      ? `${from} – ${to}`
      : `Last 365 days`;

  return (
    <div
      className="mt-6 rounded-xl p-4 md:p-6"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: "#1C1815" }}
          >
            Cost of Gain ({periodLabel})
          </h2>
          <p className="text-xs mt-1" style={{ color: "#9C8E7A" }}>
            Rand per kg of live-weight gained. Camp rows attribute gain to each
            animal&apos;s current camp — mid-period moves land in the ending camp.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div
          className="rounded-lg p-3"
          style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
        >
          <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>
            Farm COG
          </p>
          <p
            className="text-base font-bold font-mono"
            style={{ color: "#8B6914" }}
          >
            {fmtCog(summary.costOfGain)}
          </p>
        </div>
        <div
          className="rounded-lg p-3"
          style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
        >
          <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>
            Total Cost
          </p>
          <p
            className="text-base font-bold font-mono"
            style={{ color: "#1C1815" }}
          >
            {fmtR(summary.totalCost)}
          </p>
        </div>
        <div
          className="rounded-lg p-3"
          style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
        >
          <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>
            Total Gain
          </p>
          <p
            className="text-base font-bold font-mono"
            style={{ color: "#1C1815" }}
          >
            {summary.kgGained > 0 ? fmtKg(summary.kgGained) : "—"}
          </p>
        </div>
        <div
          className="rounded-lg p-3"
          style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
        >
          <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>
            Active Animals
          </p>
          <p
            className="text-base font-bold font-mono"
            style={{ color: "#1C1815" }}
          >
            {summary.activeAnimals}
          </p>
        </div>
      </div>

      {summary.kgGained === 0 ? (
        <p className="text-sm" style={{ color: "#9C8E7A" }}>
          Not enough weight history in this date range to compute Cost of Gain.
          Record at least two weighings per animal spanning the period.
        </p>
      ) : (
        <CostOfGainTablesClient
          byCamp={byCamp}
          byAnimal={byAnimal}
          scope={scope}
          farmCostOfGain={summary.costOfGain}
        />
      )}
    </div>
  );
}
