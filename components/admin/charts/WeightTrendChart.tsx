"use client";

// components/admin/charts/WeightTrendChart.tsx
// Phase J6 — Weight trend chart with regression projection overlay.
//
// Source: memory/research-phase-j-notifications.md §E point 5. Uses the
// `regression` npm package (linear least-squares) to extend the actuals line
// forward toward the target weight; dashed grey line for the projection,
// ReferenceLine at the crossover date, and an adaptive stroke colour on the
// actuals line driven by `adg` + `adgTarget` (≥target green, ≥0.7 amber, else
// red — matches weight-analytics.ts poor-doer threshold 0.7 kg/day).
//
// Back-compat: callers that only pass { points, targetWeight, projectedDate }
// (e.g. app/[farmSlug]/admin/animals/[id]/page.tsx) keep working because
// `adg`, `adgTarget`, and the new computed projection series are all optional.

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";
// @ts-expect-error — `regression` ships plain JS without type declarations.
import regression from "regression";

export interface WeightPoint {
  /** Formatted date label (caller controls locale). */
  date: string;
  weight: number | null;
  /** Linear regression value at this point. Null on projection-only rows. */
  trend: number | null;
  /** Projected weight at this label; null on actual rows. Optional. */
  projected?: number | null;
  /** Numeric day index from the first actual reading (used for regression). Optional. */
  dayIndex?: number;
}

interface Props {
  points: WeightPoint[];
  targetWeight?: number | null;
  /** Pre-computed label for when target is reached (e.g. "15 Sep 2026"). */
  projectedDate?: string | null;
  /** Best available ADG (kg/day) — drives the actuals-line colour. Optional. */
  adg?: number | null;
  /** Target ADG for the "green" band. Defaults to 0.9 kg/day. */
  adgTarget?: number;
}

const gridStroke = "#E0D5C8";
const tickStyle = { fill: "#9C8E7A", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "#1A1510",
  border: "1px solid rgba(139,105,20,0.3)",
  color: "#F5EBD4",
  fontSize: 12,
};

/**
 * Choose actuals stroke colour from ADG vs target. Mirrors the three-band
 * scheme in weight-analytics.ts::calcAdgTrend (good/ok/poor).
 * Exported for unit tests.
 */
export function adgColor(adg: number | null, adgTarget: number): string {
  if (adg === null) return "#4A7C59"; // existing default green when ADG not provided
  if (adg >= adgTarget) return "#10b981"; // good
  if (adg >= 0.7) return "#f59e0b"; // ok / warning
  return "#ef4444"; // poor
}

interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
}

/**
 * Fit a linear regression to the actual points using their `dayIndex` if
 * provided, else their array position. Returns null when fewer than 2 actuals
 * are available. Exported for unit tests.
 */
export function fitLinear(points: WeightPoint[]): LinearFit | null {
  const actuals = points.filter(
    (p): p is WeightPoint & { weight: number } => typeof p.weight === "number",
  );
  if (actuals.length < 2) return null;
  const data: Array<[number, number]> = actuals.map((p, i) => [
    typeof p.dayIndex === "number" ? p.dayIndex : i,
    p.weight,
  ]);
  // regression.linear returns { equation: [slope, intercept], predict, r2, ... }
  const fit = (regression as { linear: (data: Array<[number, number]>) => { equation: [number, number]; r2: number } })
    .linear(data);
  const [slope, intercept] = fit.equation;
  return { slope, intercept, r2: fit.r2 };
}

export default function WeightTrendChart({
  points,
  targetWeight,
  projectedDate,
  adg = null,
  adgTarget = 0.9,
}: Props) {
  if (points.length < 2) {
    return (
      <p style={{ color: "#9C8E7A", fontSize: "0.875rem", textAlign: "center", padding: "1.5rem 0" }}>
        Need 2+ weight readings to display chart
      </p>
    );
  }

  const actualsStroke = adgColor(adg, adgTarget);
  const anyProjected = points.some((p) => typeof p.projected === "number");

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey="date" tick={tickStyle} />
          <YAxis
            tick={tickStyle}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => `${v} kg`}
            width={60}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => {
              if (typeof value !== "number") return [String(value), String(name)];
              const labelMap: Record<string, string> = {
                weight: "Actual",
                trend: "Trend",
                projected: "Projected",
              };
              return [`${value.toFixed(1)} kg`, labelMap[String(name)] ?? String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#6B5C4E" }} />
          {targetWeight != null && (
            <ReferenceLine
              y={targetWeight}
              stroke="#10b981"
              strokeDasharray="4 3"
              label={{
                value: `Target ${targetWeight} kg`,
                position: "insideTopRight",
                fill: "#10b981",
                fontSize: 10,
              }}
            />
          )}
          {projectedDate && (
            <ReferenceLine
              x={projectedDate}
              stroke="#3b82f6"
              strokeDasharray="3 3"
              label={{
                value: `Projected reach`,
                position: "insideTopLeft",
                fill: "#3b82f6",
                fontSize: 10,
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="weight"
            stroke={actualsStroke}
            strokeWidth={2}
            dot={{ r: 3, fill: actualsStroke }}
            name="Actual"
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="trend"
            stroke="#C0574C"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            name="Trend (ADG)"
            connectNulls={false}
          />
          {anyProjected && (
            <Line
              type="monotone"
              dataKey="projected"
              stroke="#888888"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              name="Projected"
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
