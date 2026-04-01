"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { CategoryProfitabilityRow } from "@/lib/server/financial-analytics";

function fmt(n: number): string {
  return `R ${Math.round(Math.abs(n)).toLocaleString("en-ZA")}`;
}

export default function CategoryProfitability({
  data,
}: {
  data: CategoryProfitabilityRow[];
}) {
  if (data.length === 0) {
    return (
      <div
        className="rounded-xl p-6 text-center text-sm"
        style={{ background: "#FAFAF8", border: "1px solid #E0D5C8", color: "#9C8E7A" }}
      >
        No transactions linked to animals with categories yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Grouped bar chart */}
      <div className="rounded-xl p-4" style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#9C8E7A" }}>
          Income vs Expense by Category
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="category" tick={{ fontSize: 11, fill: "#9C8E7A" }} />
            <YAxis
              tick={{ fontSize: 11, fill: "#9C8E7A" }}
              width={70}
              tickFormatter={(v: number) =>
                v >= 1000 ? `R${(v / 1000).toFixed(0)}k` : `R${v}`
              }
            />
            <Tooltip
              formatter={(value: unknown, name: unknown) => [
                `R ${(value as number).toLocaleString("en-ZA")}`,
                typeof name === "string" ? name.charAt(0).toUpperCase() + name.slice(1) : String(name),
              ]}
              contentStyle={{
                background: "#1A1510",
                border: "1px solid rgba(139,105,20,0.3)",
                borderRadius: "8px",
                color: "#F5EBD4",
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <Bar dataKey="income" fill="#4A7C59" radius={[4, 4, 0, 0] as [number, number, number, number]} name="Income" />
            <Bar dataKey="expense" fill="#C0574C" radius={[4, 4, 0, 0] as [number, number, number, number]} name="Expense" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #E0D5C8" }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "#F5F0EA", borderBottom: "1px solid #E0D5C8" }}>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Category</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Income (R)</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Expense (R)</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Margin (R)</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Head Count</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Margin / Head</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr
                key={row.category}
                style={{
                  borderBottom: idx < data.length - 1 ? "1px solid #E0D5C8" : "none",
                  background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAF8",
                }}
              >
                <td className="px-3 py-2.5 font-medium" style={{ color: "#1C1815" }}>{row.category}</td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "#4A7C59" }}>
                  {fmt(row.income)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "#C0574C" }}>
                  {fmt(row.expense)}
                </td>
                <td
                  className="px-3 py-2.5 text-right font-mono font-semibold"
                  style={{ color: row.margin >= 0 ? "#4A7C59" : "#C0574C" }}
                >
                  {row.margin >= 0 ? "" : "-"}{fmt(row.margin)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "#1C1815" }}>
                  {row.headCount}
                </td>
                <td
                  className="px-3 py-2.5 text-right font-mono"
                  style={{ color: row.marginPerHead >= 0 ? "#4A7C59" : "#C0574C" }}
                >
                  {row.marginPerHead >= 0 ? "" : "-"}{fmt(row.marginPerHead)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
