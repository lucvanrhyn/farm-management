"use client";

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
import type { PregnancyRateCycle } from "@/lib/server/reproduction-analytics";

interface Props {
  cycles: PregnancyRateCycle[];
}

const gridStroke = "#E0D5C8";
const tickStyle = { fill: "#9C8E7A", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "#1A1510",
  border: "1px solid rgba(139,105,20,0.3)",
  color: "#F5EBD4",
  fontSize: 12,
};

// SA benchmark: >22% per 21-day cycle
const SA_BENCHMARK = 22;

export default function PregnancyRateCycleChart({ cycles }: Props) {
  if (cycles.length === 0) {
    return (
      <p style={{ color: "#9C8E7A", fontSize: "0.875rem", textAlign: "center", padding: "1.5rem 0" }}>
        No breeding season data. Log insemination events via the Logger.
      </p>
    );
  }

  const data = cycles.map((c) => ({
    label: c.label,
    rate: c.rate,
    pregnantCount: c.pregnantCount,
    eligibleCount: c.eligibleCount,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
        <XAxis dataKey="label" tick={tickStyle} />
        <YAxis
          tick={tickStyle}
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
          width={40}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, _name, entry) => {
            const v = typeof value === "number" ? value : 0;
            const p = (entry?.payload as { pregnantCount?: number; eligibleCount?: number } | undefined);
            return [`${v}%${p ? ` (${p.pregnantCount ?? 0} / ${p.eligibleCount ?? 0})` : ""}`, "Pregnancy Rate"];
          }}
        />
        <ReferenceLine
          y={SA_BENCHMARK}
          stroke="#8B6914"
          strokeDasharray="5 3"
          label={{
            value: `SA target ${SA_BENCHMARK}%`,
            position: "insideTopRight",
            fill: "#8B6914",
            fontSize: 10,
          }}
        />
        <Bar
          dataKey="rate"
          name="Rate"
          radius={[4, 4, 0, 0]}
          fill="#4A7C59"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
