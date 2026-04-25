// app/[farmSlug]/admin/animals/[id]/_components/WeightTab.tsx
// Weight + ADG dashboard for a single animal: latest, long-run, 90-day,
// poor-doer flag, trend chart, projected market date, and a session
// history table with per-row ADG.

import nextDynamic from "next/dynamic";
import type { ADGResult, WeightRecord } from "@/lib/server/weight-analytics";
import type { WeightPoint } from "@/components/admin/charts/WeightTrendChart";

const WeightTrendChart = nextDynamic(
  () => import("@/components/admin/charts/WeightTrendChart"),
  { loading: () => <div className="h-48 animate-pulse bg-gray-100 rounded-lg" /> },
);

// Standard SA market weight reference (450 kg — can be made configurable later)
const TARGET_MARKET_WEIGHT = 450;

const ADG_BADGE: Record<"good" | "ok" | "poor", { bg: string; text: string; label: string }> = {
  good: { bg: "rgba(74,124,89,0.12)",   text: "#2D6A4F", label: "Good (>0.9 kg/day)"  },
  ok:   { bg: "rgba(180,110,20,0.12)",  text: "#8B6914", label: "OK (0.7–0.9 kg/day)" },
  poor: { bg: "rgba(192,87,76,0.12)",   text: "#8B3A3A", label: "Poor (<0.7 kg/day)"  },
};

function adgBadge(trend: "good" | "ok" | "poor" | null, value: number | null) {
  if (value === null || trend === null) return null;
  const b = ADG_BADGE[trend];
  return (
    <span
      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: b.bg, color: b.text }}
    >
      {b.label}
    </span>
  );
}

/** Compute linear regression trend line values for the weight records. */
function buildWeightPoints(records: WeightRecord[]): WeightPoint[] {
  if (records.length < 2) return [];
  const n = records.length;
  const xs = records.map((_, i) => i);
  const ys = records.map((r) => r.weightKg);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return records.map((r, i) => ({
    date: new Date(r.observedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" }),
    weight: Math.round(r.weightKg * 10) / 10,
    trend: Math.round((slope * i + intercept) * 10) / 10,
  }));
}

/** Compute projected date to reach target weight given latest ADG. */
function projectedMarketDate(latestWeight: number, targetWeight: number, adg: number): string | null {
  if (adg <= 0) return null;
  const daysNeeded = (targetWeight - latestWeight) / adg;
  if (daysNeeded < 0) return null;
  const d = new Date(Date.now() + daysNeeded * 86_400_000);
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

interface WeightTabProps {
  weightData: ADGResult;
}

export function WeightTab({ weightData }: WeightTabProps) {
  const {
    latestWeight, adg, adgTrend,
    longRunAdg, longRunAdgTrend,
    rolling90Adg, rolling90AdgTrend,
    isPoorDoer, records,
  } = weightData;
  const reversedRecords = [...records].reverse();
  const weightPoints = buildWeightPoints(records);

  // Best ADG for projected date
  const bestAdg = rolling90Adg ?? longRunAdg ?? adg;
  const projected = latestWeight !== null && bestAdg !== null && bestAdg > 0
    ? projectedMarketDate(latestWeight, TARGET_MARKET_WEIGHT, bestAdg)
    : null;

  return (
    <div
      className="rounded-2xl border p-5 space-y-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      {/* Header with poor doer flag */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
          Weight & ADG
        </h2>
        {isPoorDoer && (
          <span
            className="text-[11px] font-bold px-3 py-1 rounded-full"
            style={{ background: "rgba(192,87,76,0.15)", color: "#8B3A3A", border: "1px solid rgba(192,87,76,0.3)" }}
          >
            Poor Doer (&lt;0.7 kg/day)
          </span>
        )}
      </div>

      {/* Summary row: Latest weight + ADG cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-xl p-4" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
          <p className="text-xs mb-1" style={{ color: "#9C8E7A" }}>Latest Weight</p>
          <p className="text-2xl font-bold font-mono" style={{ color: "#1C1815" }}>
            {latestWeight !== null ? `${latestWeight.toFixed(1)} kg` : "—"}
          </p>
        </div>
        <div className="rounded-xl p-4" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
          <p className="text-xs mb-1" style={{ color: "#9C8E7A" }}>Long-run ADG</p>
          {longRunAdg !== null ? (
            <div className="space-y-1">
              <p className="text-2xl font-bold font-mono" style={{ color: "#1C1815" }}>
                {longRunAdg >= 0 ? "+" : ""}{longRunAdg.toFixed(2)} kg/d
              </p>
              {adgBadge(longRunAdgTrend, longRunAdg)}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "#9C8E7A" }}>
              {records.length === 0 ? "No data" : "Need 2+ readings"}
            </p>
          )}
        </div>
        <div className="rounded-xl p-4" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
          <p className="text-xs mb-1" style={{ color: "#9C8E7A" }}>90-day ADG</p>
          {rolling90Adg !== null ? (
            <div className="space-y-1">
              <p className="text-2xl font-bold font-mono" style={{ color: "#1C1815" }}>
                {rolling90Adg >= 0 ? "+" : ""}{rolling90Adg.toFixed(2)} kg/d
              </p>
              {adgBadge(rolling90AdgTrend, rolling90Adg)}
            </div>
          ) : adg !== null ? (
            <div className="space-y-1">
              <p className="text-sm font-mono font-semibold" style={{ color: "#1C1815" }}>
                {adg >= 0 ? "+" : ""}{adg.toFixed(2)} kg/d
              </p>
              <p className="text-[10px]" style={{ color: "#9C8E7A" }}>last interval</p>
              {adgBadge(adgTrend, adg)}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "#9C8E7A" }}>
              {records.length === 0 ? "No data" : "Need 2+ readings"}
            </p>
          )}
        </div>
      </div>

      {/* Weight trend chart */}
      {records.length >= 2 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9C8E7A" }}>
            Weight Trend
            {projected && (
              <span className="ml-2 normal-case font-normal" style={{ color: "#8B6914" }}>
                · Projected market date: {projected}
              </span>
            )}
          </p>
          <div className="rounded-xl overflow-hidden p-3" style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}>
            <WeightTrendChart
              points={weightPoints}
              targetWeight={TARGET_MARKET_WEIGHT}
              projectedDate={projected}
            />
          </div>
        </div>
      )}

      {/* History table or empty state */}
      {records.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl"
          style={{ background: "#FAFAF8", border: "1px dashed #E0D5C8" }}
        >
          <p className="text-sm font-medium" style={{ color: "#9C8E7A" }}>No weight recordings yet.</p>
          <p className="text-xs text-center max-w-xs" style={{ color: "#9C8E7A" }}>
            Weighing sessions are recorded in the Logger. Once recorded they will appear here.
          </p>
        </div>
      ) : (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9C8E7A" }}>
            History ({records.length} sessions)
          </p>
          <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #E0D5C8" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "#F5F0EA", borderBottom: "1px solid #E0D5C8" }}>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Date</th>
                  <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Weight (kg)</th>
                  <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>ADG vs prev</th>
                </tr>
              </thead>
              <tbody>
                {reversedRecords.map((rec: WeightRecord, idx: number) => {
                  const originalIdx = records.findIndex((r) => r.id === rec.id);
                  const prevRec = originalIdx > 0 ? records[originalIdx - 1] : null;
                  let rowAdg: number | null = null;
                  if (prevRec) {
                    const days =
                      (rec.observedAt.getTime() - prevRec.observedAt.getTime()) /
                      (1000 * 60 * 60 * 24);
                    rowAdg = days > 0 ? (rec.weightKg - prevRec.weightKg) / days : null;
                  }
                  const adgColor =
                    rowAdg === null
                      ? "#9C8E7A"
                      : rowAdg > 0.9
                      ? "#2D6A4F"
                      : rowAdg >= 0.7
                      ? "#8B6914"
                      : "#8B3A3A";

                  return (
                    <tr
                      key={rec.id}
                      style={{
                        borderBottom: idx < reversedRecords.length - 1 ? "1px solid #E0D5C8" : "none",
                        background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAF8",
                      }}
                    >
                      <td className="px-3 py-2.5 font-mono" style={{ color: "#1C1815" }}>
                        {new Date(rec.observedAt).toLocaleDateString("en-ZA")}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold font-mono" style={{ color: "#1C1815" }}>
                        {rec.weightKg.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold" style={{ color: adgColor }}>
                        {rowAdg !== null
                          ? `${rowAdg >= 0 ? "+" : ""}${rowAdg.toFixed(2)}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
