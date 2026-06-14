"use client";

// components/admin/charts/DaysOpenHistogram.tsx
// Phase J5a — Days Open distribution histogram.
//
// Source: memory/research-phase-j-notifications.md §E point 2.
// Benchmark: beef target ≤85–95d, SA smallholder actual 152d (PMC9657001).
// Industry-benchmark ReferenceLine at 95d target; another at mean (yellow).
//
// Bins DaysOpenRecord[] from reproduction-analytics into fixed 20-day buckets
// so the histogram is stable across tenants regardless of range.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { DaysOpenRecord } from "@/lib/server/reproduction-analytics";

interface Props {
  records: DaysOpenRecord[];
  avgDaysOpen: number | null;
  /** Industry target, defaults to 95d (UT Beef W973 + CHAPS). */
  targetDays?: number;
}

// Match visual language of PregnancyRateCycleChart (§E consistency).
const gridStroke = "var(--ft-border)";
const tickStyle = { fill: "var(--ft-subtle)", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "var(--ft-text)",
  border: "1px solid rgba(139,105,20,0.3)",
  color: "var(--ft-fair-bg)",
  fontSize: 12,
};

// 20-day buckets from 0 to 200, then an open-ended 200+ bucket.
const BIN_BOUNDS: ReadonlyArray<readonly [number, number | null]> = [
  [0, 20],
  [21, 40],
  [41, 60],
  [61, 80],
  [81, 100],
  [101, 120],
  [121, 140],
  [141, 160],
  [161, 180],
  [181, 200],
  [201, null], // 200+ open-ended
] as const;

function binLabel(lo: number, hi: number | null): string {
  return hi === null ? "200+" : `${lo}-${hi}`;
}

interface Bin {
  label: string;
  lo: number;
  hi: number | null;
  count: number;
}

/** Pure: does not mutate the input records array. */
export function buildBins(records: DaysOpenRecord[]): Bin[] {
  const bins: Bin[] = BIN_BOUNDS.map(([lo, hi]) => ({ label: binLabel(lo, hi), lo, hi, count: 0 }));
  for (const r of records) {
    if (r.daysOpen === null) continue; // open cows don't fit the histogram; shown elsewhere
    const v = r.daysOpen;
    for (const b of bins) {
      const inBin = b.hi === null ? v >= b.lo : v >= b.lo && v <= b.hi;
      if (inBin) {
        b.count += 1;
        break;
      }
    }
  }
  return bins;
}

/** Which bin label contains the given mean value (for the mean ReferenceLine). */
export function meanBinLabel(mean: number): string {
  for (const [lo, hi] of BIN_BOUNDS) {
    const inBin = hi === null ? mean >= lo : mean >= lo && mean <= hi;
    if (inBin) return binLabel(lo, hi);
  }
  return "200+";
}

export default function DaysOpenHistogram({ records, avgDaysOpen, targetDays = 95 }: Props) {
  if (records.length === 0) {
    return (
      <p style={{ color: "var(--ft-subtle)", fontSize: "0.875rem", textAlign: "center", padding: "1.5rem 0" }}>
        No calving → conception events recorded yet
      </p>
    );
  }

  const bins = buildBins(records);
  const targetLabel = meanBinLabel(targetDays); // "81-100" for default 95
  const meanLabel = avgDaysOpen !== null ? meanBinLabel(avgDaysOpen) : null;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={bins} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
        <XAxis dataKey="label" tick={tickStyle} />
        <YAxis tick={tickStyle} width={32} allowDecimals={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => [`${value} animals`, "Count"]}
          labelFormatter={(label) => `${label} days open`}
        />
        <ReferenceLine
          x={targetLabel}
          stroke="var(--ft-good)"
          strokeDasharray="4 3"
          label={{
            value: `Target ≤${targetDays}d`,
            position: "insideTopRight",
            fill: "var(--ft-good)",
            fontSize: 10,
          }}
        />
        {meanLabel !== null && avgDaysOpen !== null && (
          <ReferenceLine
            x={meanLabel}
            stroke="var(--ft-fair)"
            strokeDasharray="5 3"
            label={{
              value: `Mean ${avgDaysOpen}d`,
              position: "insideTopLeft",
              fill: "var(--ft-fair)",
              fontSize: 10,
            }}
          />
        )}
        <Bar dataKey="count" name="Animals" radius={[4, 4, 0, 0]} fill="var(--ft-info)" />
      </BarChart>
    </ResponsiveContainer>
  );
}
