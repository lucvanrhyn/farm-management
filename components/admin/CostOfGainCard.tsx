import { calcCostOfGain } from "@/lib/calculators/cost-of-gain";
import type { AnimalInvestmentResult } from "@/lib/server/financial-analytics";
import type { ADGResult } from "@/lib/server/weight-analytics";

function fmtR(n: number): string {
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

function fmtCog(n: number | null): string {
  return n === null ? "—" : `R ${n.toFixed(2)}/kg`;
}

export default function CostOfGainCard({
  investment,
  weight,
}: {
  investment: AnimalInvestmentResult;
  weight: ADGResult;
}) {
  const records = weight.records;
  const first = records[0];
  const last = records[records.length - 1];

  const insufficient =
    records.length < 2 ||
    !first ||
    !last ||
    last.weightKg <= first.weightKg;

  const kgGained = insufficient ? 0 : last.weightKg - first.weightKg;
  const result = calcCostOfGain({
    totalCost: investment.totalCost,
    kgGained,
  });

  return (
    <div
      className="rounded-xl p-4 md:p-6"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            Cost of Gain
          </h3>
          <p className="text-xs mt-1" style={{ color: "#9C8E7A" }}>
            Rand per kilogram gained from first to latest weighing.
          </p>
        </div>
        <p
          className="text-lg font-bold font-mono"
          style={{ color: "#8B6914" }}
        >
          {insufficient ? "—" : fmtCog(result.costOfGain)}
        </p>
      </div>

      {insufficient ? (
        <p className="text-sm" style={{ color: "#9C8E7A" }}>
          Need at least two weighings with positive gain to compute Cost of Gain
          for this animal.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div
            className="rounded-lg p-3"
            style={{
              background: "#FAFAF8",
              border: "1px solid #E0D5C8",
            }}
          >
            <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>
              Total Cost
            </p>
            <p
              className="text-sm font-bold font-mono"
              style={{ color: "#1C1815" }}
            >
              {fmtR(investment.totalCost)}
            </p>
          </div>
          <div
            className="rounded-lg p-3"
            style={{
              background: "#FAFAF8",
              border: "1px solid #E0D5C8",
            }}
          >
            <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>
              Gain
            </p>
            <p
              className="text-sm font-bold font-mono"
              style={{ color: "#1C1815" }}
            >
              {kgGained.toFixed(1)} kg
            </p>
          </div>
          <div
            className="rounded-lg p-3"
            style={{
              background: "#FAFAF8",
              border: "1px solid #E0D5C8",
            }}
          >
            <p className="text-[11px] mb-1" style={{ color: "#9C8E7A" }}>
              Period
            </p>
            <p
              className="text-sm font-bold font-mono"
              style={{ color: "#1C1815" }}
            >
              {first.observedAt.toISOString().slice(0, 10)} →{" "}
              {last.observedAt.toISOString().slice(0, 10)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
