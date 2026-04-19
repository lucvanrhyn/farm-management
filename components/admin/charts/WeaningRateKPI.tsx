"use client";

// components/admin/charts/WeaningRateKPI.tsx
// Phase J5b — Weaning Rate KPI tile with trailing sparkline.
//
// Source: memory/research-phase-j-notifications.md §E point 3.
// Benchmark: University of Tennessee W973 + CHAPS → 88% good, 80% acceptable.
// Three-band colour, sparkline is optional (hidden when history empty).

import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";

export interface WeaningHistoryPoint {
  year: number;
  rate: number;
}

interface Props {
  weaningRate: number | null;
  history: WeaningHistoryPoint[];
  /** Excellent threshold, defaults to 88 (UT W973). */
  target?: number;
}

type Band = "green" | "amber" | "red" | "gray";

export function weaningBand(rate: number | null, target: number): Band {
  if (rate === null) return "gray";
  if (rate >= target) return "green";
  if (rate >= 80) return "amber";
  return "red";
}

const BAND_COLORS: Record<Band, { fg: string; bg: string; border: string }> = {
  green: { fg: "#166534", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.25)" },
  amber: { fg: "#92400E", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)" },
  red: { fg: "#991B1B", bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.25)" },
  gray: { fg: "#6B5C4E", bg: "#FAFAF8", border: "#E0D5C8" },
};

export default function WeaningRateKPI({ weaningRate, history, target = 88 }: Props) {
  const band = weaningBand(weaningRate, target);
  const colors = BAND_COLORS[band];
  const displayValue = weaningRate === null ? "—" : `${weaningRate}%`;

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <p
        className="text-xs font-semibold uppercase tracking-wide mb-1"
        style={{ color: "#9C8E7A" }}
      >
        Weaning Rate
      </p>

      <p
        className="font-bold tabular-nums"
        style={{ fontSize: "3rem", lineHeight: "1.1", color: colors.fg }}
      >
        {displayValue}
      </p>

      <p className="text-xs mt-1" style={{ color: colors.fg, opacity: 0.85 }}>
        Target ≥{target}%
      </p>

      {/* Thresholds legend */}
      <p className="text-[10px] mt-2" style={{ color: "#9C8E7A" }}>
        ≥{target}% excellent · ≥80% acceptable
      </p>

      {history.length > 0 ? (
        <div className="mt-3" style={{ height: 40 }}>
          <ResponsiveContainer width="100%" height={40}>
            <LineChart data={history} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
              <YAxis hide domain={["dataMin - 5", "dataMax + 5"]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1A1510",
                  border: "1px solid rgba(139,105,20,0.3)",
                  color: "#F5EBD4",
                  fontSize: 11,
                }}
                formatter={(value) => {
                  const num = typeof value === "number" ? value : Number(value);
                  return [`${num}%`, "Weaning"];
                }}
                labelFormatter={(y) => `Year ${y}`}
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke={colors.fg}
                strokeWidth={2}
                dot={{ r: 2, fill: colors.fg }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p
          className="text-[10px] italic mt-3"
          style={{ color: "#9C8E7A" }}
        >
          Track weaning across years to see trend
        </p>
      )}
    </div>
  );
}
