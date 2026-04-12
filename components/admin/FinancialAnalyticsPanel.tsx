"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { FinancialAnalyticsResult } from "@/lib/server/financial-analytics";

export default function FinancialAnalyticsPanel({ farmSlug }: { farmSlug: string }) {
  const searchParams = useSearchParams();
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");

  const effectiveFrom = rawFrom ?? "";
  const effectiveTo = rawTo ?? "";

  const [data, setData] = useState<FinancialAnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams();
    if (effectiveFrom) params.set("from", effectiveFrom);
    if (effectiveTo) params.set("to", effectiveTo);
    const query = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/${farmSlug}/financial-analytics${query}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d: FinancialAnalyticsResult) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name !== "AbortError") setLoading(false);
      });
    return () => controller.abort();
  }, [farmSlug, effectiveFrom, effectiveTo]);

  const fmt = (n: number) =>
    `R ${Math.abs(Math.round(n)).toLocaleString("en-ZA")}`;

  return (
    <div
      className="mt-8 rounded-xl p-4 md:p-6"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            Financial Analytics
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
            {effectiveFrom} → {effectiveTo}
          </p>
        </div>
      </div>

      {loading && (
        <div
          className="h-32 flex items-center justify-center text-xs"
          style={{ color: "#9C8E7A" }}
        >
          Loading…
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {[
              {
                label: "Gross Margin",
                value: fmt(data.grossMargin),
                color: data.grossMargin >= 0 ? "#4A7C59" : "#C0574C",
              },
              {
                label: "Gross Margin / Head",
                value:
                  data.grossMarginPerHead !== null
                    ? fmt(data.grossMarginPerHead)
                    : "—",
                color:
                  data.grossMarginPerHead !== null && data.grossMarginPerHead >= 0
                    ? "#4A7C59"
                    : "#C0574C",
              },
              {
                label: "Cost of Gain",
                value:
                  data.costOfGain !== null
                    ? `R ${data.costOfGain.toFixed(2)}/kg`
                    : "—",
                color: "#8B6914",
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-lg p-4"
                style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
              >
                <p className="text-xs mb-1.5" style={{ color: "#9C8E7A" }}>
                  {label}
                </p>
                <p className="text-xl font-bold font-mono" style={{ color }}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {data.expensesByCategory.length > 0 ? (
            <div>
              <p
                className="text-xs font-semibold mb-3 uppercase tracking-wide"
                style={{ color: "#9C8E7A" }}
              >
                Expenses by Category
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={data.expensesByCategory}
                  margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                >
                  <XAxis
                    dataKey="category"
                    tick={{ fontSize: 11, fill: "#9C8E7A" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#9C8E7A" }}
                    width={65}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `R${(v / 1000).toFixed(0)}k` : `R${v}`
                    }
                  />
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
                  <Bar
                    dataKey="amount"
                    fill="#8B6914"
                    radius={[4, 4, 0, 0] as [number, number, number, number]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "#9C8E7A" }}>
              No expense transactions in this period.
            </p>
          )}
        </>
      )}
    </div>
  );
}
