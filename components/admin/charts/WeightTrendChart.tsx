"use client";

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

export interface WeightPoint {
  date: string;      // formatted date label
  weight: number;
  trend: number;     // linear regression value at this point
}

interface Props {
  points: WeightPoint[];
  targetWeight?: number | null;
  projectedDate?: string | null;
}

const gridStroke = "#E0D5C8";
const tickStyle = { fill: "#9C8E7A", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "#1A1510",
  border: "1px solid rgba(139,105,20,0.3)",
  color: "#F5EBD4",
  fontSize: 12,
};

export default function WeightTrendChart({ points, targetWeight, projectedDate }: Props) {
  if (points.length < 2) {
    return (
      <p style={{ color: "#9C8E7A", fontSize: "0.875rem", textAlign: "center", padding: "1.5rem 0" }}>
        Need 2+ weight readings to display chart
      </p>
    );
  }

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
            formatter={(value, name) => [
              typeof value === "number" ? `${value.toFixed(1)} kg` : String(value),
              name === "weight" ? "Actual" : "Trend",
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#6B5C4E" }} />
          {targetWeight != null && (
            <ReferenceLine
              y={targetWeight}
              stroke="#8B6914"
              strokeDasharray="4 3"
              label={{
                value: `Target ${targetWeight} kg${projectedDate ? ` (${projectedDate})` : ""}`,
                position: "insideTopRight",
                fill: "#8B6914",
                fontSize: 10,
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="weight"
            stroke="#4A7C59"
            strokeWidth={2}
            dot={{ r: 3, fill: "#4A7C59" }}
            name="Actual"
          />
          <Line
            type="monotone"
            dataKey="trend"
            stroke="#C0574C"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            name="Trend (ADG)"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
