"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { CampCostRow } from "@/lib/server/financial-analytics";

type SortKey = "totalCost" | "costPerHa";

function fmt(n: number): string {
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

export default function CampCostAnalysis({ data }: { data: CampCostRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("totalCost");

  const sorted = [...data].sort((a, b) => {
    if (sortKey === "costPerHa") {
      const aVal = a.costPerHa ?? -1;
      const bVal = b.costPerHa ?? -1;
      return bVal - aVal;
    }
    return b.totalCost - a.totalCost;
  });

  if (data.length === 0) {
    return (
      <div
        className="rounded-xl p-6 text-center text-sm"
        style={{ background: "#FAFAF8", border: "1px solid #E0D5C8", color: "#9C8E7A" }}
      >
        No expense transactions linked to camps yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bar chart */}
      <div className="rounded-xl p-4" style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#9C8E7A" }}>
          Total Cost by Camp
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={sorted} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="campName" tick={{ fontSize: 11, fill: "#9C8E7A" }} />
            <YAxis
              tick={{ fontSize: 11, fill: "#9C8E7A" }}
              width={70}
              tickFormatter={(v: number) =>
                v >= 1000 ? `R${(v / 1000).toFixed(0)}k` : `R${v}`
              }
            />
            <Tooltip
              formatter={(value: unknown) => [
                `R ${(value as number).toLocaleString("en-ZA")}`,
                "Total Cost",
              ]}
              contentStyle={{
                background: "#1A1510",
                border: "1px solid rgba(139,105,20,0.3)",
                borderRadius: "8px",
                color: "#F5EBD4",
                fontSize: "12px",
              }}
            />
            <Bar
              dataKey="totalCost"
              fill="#C0574C"
              radius={[4, 4, 0, 0] as [number, number, number, number]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Sort controls */}
      <div className="flex gap-2 text-xs">
        <span style={{ color: "#9C8E7A" }}>Sort by:</span>
        {(["totalCost", "costPerHa"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setSortKey(key)}
            className="px-2 py-0.5 rounded font-medium transition-colors"
            style={{
              background: sortKey === key ? "#1C1815" : "transparent",
              color: sortKey === key ? "#FAFAF8" : "#9C8E7A",
              border: "1px solid #E0D5C8",
            }}
          >
            {key === "totalCost" ? "Total Cost" : "Cost / Ha"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #E0D5C8" }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "#F5F0EA", borderBottom: "1px solid #E0D5C8" }}>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Camp</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Total Cost (R)</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Hectares</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Cost / Ha (R)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => (
              <tr
                key={row.campId}
                style={{
                  borderBottom: idx < sorted.length - 1 ? "1px solid #E0D5C8" : "none",
                  background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAF8",
                }}
              >
                <td className="px-3 py-2.5 font-medium" style={{ color: "#1C1815" }}>{row.campName}</td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "#C0574C" }}>
                  {fmt(row.totalCost)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "#1C1815" }}>
                  {row.hectares !== null ? row.hectares.toFixed(1) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "#8B6914" }}>
                  {row.costPerHa !== null ? fmt(row.costPerHa) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
