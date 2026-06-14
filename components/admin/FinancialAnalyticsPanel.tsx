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

  // Combined fetch state keyed by request parameters — loading is derived in
  // render from whether the result key matches, so no synchronous setState in
  // the effect body (eliminates the lint rule cascade concern).
  const fetchKey = `${farmSlug}|${effectiveFrom}|${effectiveTo}`;
  const [result, setResult] = useState<{
    key: string;
    data: FinancialAnalyticsResult | null;
  } | null>(null);

  // Derived: loading when result is absent or for a stale key.
  const loading = result === null || result.key !== fetchKey;
  const data = result?.key === fetchKey ? result.data : null;

  useEffect(() => {
    const controller = new AbortController();
    const key = fetchKey;
    const params = new URLSearchParams();
    if (effectiveFrom) params.set("from", effectiveFrom);
    if (effectiveTo) params.set("to", effectiveTo);
    const query = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/${farmSlug}/financial-analytics${query}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FinancialAnalyticsResult | null) => {
        setResult({ key, data: d });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name !== "AbortError") {
          setResult({ key, data: null });
        }
      });
    return () => controller.abort();
    // fetchKey is a stable string derived from farmSlug + effective dates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  const fmt = (n: number) =>
    `R ${Math.abs(Math.round(n)).toLocaleString("en-ZA")}`;

  return (
    <div
      className="mt-8 rounded-xl p-4 md:p-6"
      style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
            Financial Analytics
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--ft-subtle)" }}>
            {effectiveFrom} → {effectiveTo}
          </p>
        </div>
      </div>

      {loading && (
        <div
          className="h-32 flex items-center justify-center text-xs"
          style={{ color: "var(--ft-subtle)" }}
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
                color: data.grossMargin >= 0 ? "var(--ft-good)" : "var(--ft-poor)",
              },
              {
                label: "Gross Margin / Head",
                value:
                  data.grossMarginPerHead !== null
                    ? fmt(data.grossMarginPerHead)
                    : "—",
                color:
                  data.grossMarginPerHead !== null && data.grossMarginPerHead >= 0
                    ? "var(--ft-good)"
                    : "var(--ft-poor)",
              },
              {
                label: "Cost of Gain",
                value:
                  data.costOfGain !== null
                    ? `R ${data.costOfGain.toFixed(2)}/kg`
                    : "—",
                color: "var(--ft-fair)",
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-lg p-4"
                style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)" }}
              >
                <p className="text-xs mb-1.5" style={{ color: "var(--ft-subtle)" }}>
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
                style={{ color: "var(--ft-subtle)" }}
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
                    tick={{ fontSize: 11, fill: "var(--ft-subtle)" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--ft-subtle)" }}
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
                      background: "var(--ft-text)",
                      border: "1px solid rgba(139,105,20,0.3)",
                      borderRadius: "8px",
                      color: "var(--ft-fair-bg)",
                      fontSize: "12px",
                    }}
                  />
                  <Bar
                    dataKey="amount"
                    fill="var(--ft-fair)"
                    radius={[4, 4, 0, 0] as [number, number, number, number]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>
              No expense transactions in this period.
            </p>
          )}
        </>
      )}
    </div>
  );
}
