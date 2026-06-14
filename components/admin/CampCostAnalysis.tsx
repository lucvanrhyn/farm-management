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
        style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)", color: "var(--ft-subtle)" }}
      >
        No expense transactions linked to camps yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bar chart */}
      <div className="rounded-xl p-4" style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--ft-subtle)" }}>
          Total Cost by Camp
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={sorted} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="campName" tick={{ fontSize: 11, fill: "var(--ft-subtle)" }} />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--ft-subtle)" }}
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
                background: "var(--ft-text)",
                border: "1px solid rgba(139,105,20,0.3)",
                borderRadius: "8px",
                color: "var(--ft-fair-bg)",
                fontSize: "12px",
              }}
            />
            <Bar
              dataKey="totalCost"
              fill="var(--ft-poor)"
              radius={[4, 4, 0, 0] as [number, number, number, number]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Sort controls */}
      <div className="flex gap-2 text-xs">
        <span style={{ color: "var(--ft-subtle)" }}>Sort by:</span>
        {(["totalCost", "costPerHa"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setSortKey(key)}
            className="px-2 py-0.5 rounded font-medium transition-colors"
            style={{
              background: sortKey === key ? "var(--ft-text)" : "transparent",
              color: sortKey === key ? "var(--ft-bg)" : "var(--ft-subtle)",
              border: "1px solid var(--ft-border)",
            }}
          >
            {key === "totalCost" ? "Total Cost" : "Cost / Ha"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--ft-border)" }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "var(--ft-surface)", borderBottom: "1px solid var(--ft-border)" }}>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Camp</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Total Cost (R)</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Hectares</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Cost / Ha (R)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => (
              <tr
                key={row.campId}
                style={{
                  borderBottom: idx < sorted.length - 1 ? "1px solid var(--ft-border)" : "none",
                  background: idx % 2 === 0 ? "#FFFFFF" : "var(--ft-bg)",
                }}
              >
                <td className="px-3 py-2.5 font-medium" style={{ color: "var(--ft-text)" }}>{row.campName}</td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "var(--ft-poor)" }}>
                  {fmt(row.totalCost)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "var(--ft-text)" }}>
                  {row.hectares !== null ? row.hectares.toFixed(1) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono" style={{ color: "var(--ft-fair)" }}>
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
