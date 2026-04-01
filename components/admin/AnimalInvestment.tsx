"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { AnimalInvestmentResult } from "@/lib/server/financial-analytics";

const COLOURS = ["#C0574C", "#8B6914", "#4A7C59", "#1D4ED8", "#9C8E7A"];

function fmt(n: number): string {
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

export default function AnimalInvestment({
  data,
}: {
  data: AnimalInvestmentResult | null;
}) {
  if (!data || data.totalCost === 0) {
    return (
      <div
        className="rounded-2xl border p-5 text-sm"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8", color: "#9C8E7A" }}
      >
        No financial transactions recorded for this animal.
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-5 space-y-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
          Animal Investment
        </h2>
        <div
          className="px-3 py-1 rounded-full text-sm font-bold font-mono"
          style={{ background: "rgba(192,87,76,0.1)", color: "#C0574C", border: "1px solid rgba(192,87,76,0.2)" }}
        >
          {fmt(data.totalCost)} total
        </div>
      </div>

      {/* Donut chart */}
      {data.breakdown.length > 0 && (
        <div className="flex justify-center">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data.breakdown}
                dataKey="amount"
                nameKey="category"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={2}
              >
                {data.breakdown.map((entry, index) => (
                  <Cell
                    key={entry.category}
                    fill={COLOURS[index % COLOURS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: unknown) => [
                  `R ${(value as number).toLocaleString("en-ZA")}`,
                  "Amount",
                ]}
                contentStyle={{
                  background: "#1A1510",
                  border: "1px solid rgba(139,105,20,0.3)",
                  borderRadius: "8px",
                  color: "#F5EBD4",
                  fontSize: "12px",
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: "11px", color: "#9C8E7A" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Breakdown table */}
      <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #E0D5C8" }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "#F5F0EA", borderBottom: "1px solid #E0D5C8" }}>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Category</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Amount (R)</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>% of Total</th>
            </tr>
          </thead>
          <tbody>
            {data.breakdown.map((row, idx) => (
              <tr
                key={row.category}
                style={{
                  borderBottom: idx < data.breakdown.length - 1 ? "1px solid #E0D5C8" : "none",
                  background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAF8",
                }}
              >
                <td className="px-3 py-2.5 capitalize" style={{ color: "#1C1815" }}>{row.category}</td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "#C0574C" }}>
                  {fmt(row.amount)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "#9C8E7A" }}>
                  {data.totalCost > 0 ? `${((row.amount / data.totalCost) * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
