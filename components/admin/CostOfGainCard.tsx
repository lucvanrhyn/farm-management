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
      style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
    >
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
            Cost of Gain
          </h3>
          <p className="text-xs mt-1" style={{ color: "var(--ft-subtle)" }}>
            Rand per kilogram gained from first to latest weighing.
          </p>
        </div>
        <p
          className="text-lg font-bold font-mono"
          style={{ color: "var(--ft-fair)" }}
        >
          {insufficient ? "—" : fmtCog(result.costOfGain)}
        </p>
      </div>

      {insufficient ? (
        <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>
          Need at least two weighings with positive gain to compute Cost of Gain
          for this animal.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div
            className="rounded-lg p-3"
            style={{
              background: "var(--ft-bg)",
              border: "1px solid var(--ft-border)",
            }}
          >
            <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>
              Total Cost
            </p>
            <p
              className="text-sm font-bold font-mono"
              style={{ color: "var(--ft-text)" }}
            >
              {fmtR(investment.totalCost)}
            </p>
          </div>
          <div
            className="rounded-lg p-3"
            style={{
              background: "var(--ft-bg)",
              border: "1px solid var(--ft-border)",
            }}
          >
            <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>
              Gain
            </p>
            <p
              className="text-sm font-bold font-mono"
              style={{ color: "var(--ft-text)" }}
            >
              {kgGained.toFixed(1)} kg
            </p>
          </div>
          <div
            className="rounded-lg p-3"
            style={{
              background: "var(--ft-bg)",
              border: "1px solid var(--ft-border)",
            }}
          >
            <p className="text-[11px] mb-1" style={{ color: "var(--ft-subtle)" }}>
              Period
            </p>
            <p
              className="text-sm font-bold font-mono"
              style={{ color: "var(--ft-text)" }}
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
