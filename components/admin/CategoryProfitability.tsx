"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
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
import type { AnimalProfitabilityRow } from "@/lib/calculators/profitability-per-animal";

function fmt(n: number): string {
  return `R ${Math.round(Math.abs(n)).toLocaleString("en-ZA")}`;
}

export default function CategoryProfitability({
  data,
  farmSlug,
  from,
  to,
}: {
  data: CategoryProfitabilityRow[];
  farmSlug: string;
  from?: string;
  to?: string;
}) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [animalData, setAnimalData] = useState<AnimalProfitabilityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const prevFromRef = useRef(from);
  const prevToRef = useRef(to);

  useEffect(() => {
    if (prevFromRef.current !== from || prevToRef.current !== to) {
      setAnimalData(null);
      setFetchError(null);
      setExpandedCategories(new Set());
      prevFromRef.current = from;
      prevToRef.current = to;
    }
  }, [from, to]);

  const fetchAnimalData = useCallback(async () => {
    if (animalData !== null || loading) return; // already loaded or fetch in-flight — skip
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(
        `/api/${farmSlug}/profitability-by-animal?${params.toString()}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setAnimalData(await res.json());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load animal data");
    } finally {
      setLoading(false);
    }
  }, [animalData, loading, farmSlug, from, to]);

  const toggleCategory = useCallback(
    (category: string) => {
      setExpandedCategories((prev) => {
        const next = new Set(prev);
        if (next.has(category)) {
          next.delete(category);
        } else {
          next.add(category);
          fetchAnimalData();
        }
        return next;
      });
    },
    [fetchAnimalData]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase()

  const categoriesToShow = data.map((row) => {
    if (!normalizedQuery) return { ...row, forceExpand: false }
    const matches = (animalData ?? []).filter(
      (a) =>
        a.category === row.category &&
        (a.tagNumber.toLowerCase().includes(normalizedQuery) ||
          (a.name?.toLowerCase() ?? '').includes(normalizedQuery)),
    )
    return { ...row, forceExpand: matches.length > 0 }
  })

  if (data.length === 0) {
    return (
      <div
        className="rounded-xl p-6 text-center text-sm"
        style={{ background: "var(--ft-bg)", border: "1px solid var(--ft-border)", color: "var(--ft-subtle)" }}
      >
        No transactions linked to animals with categories yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Grouped bar chart */}
      <div className="rounded-xl p-4" style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--ft-subtle)" }}>
          Income vs Expense by Category
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="category" tick={{ fontSize: 11, fill: "var(--ft-subtle)" }} />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--ft-subtle)" }}
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
                background: "var(--ft-text)",
                border: "1px solid rgba(139,105,20,0.3)",
                borderRadius: "8px",
                color: "var(--ft-fair-bg)",
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <Bar dataKey="income" fill="var(--ft-good)" radius={[4, 4, 0, 0] as [number, number, number, number]} name="Income" />
            <Bar dataKey="expense" fill="var(--ft-poor)" radius={[4, 4, 0, 0] as [number, number, number, number]} name="Expense" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search animals by tag or name…"
          value={searchQuery}
          onChange={(e) => {
            const q = e.target.value
            setSearchQuery(q)
            if (q.trim() && animalData === null && !loading) {
              fetchAnimalData()
            }
          }}
          style={{
            width: "100%",
            maxWidth: 280,
            borderRadius: 6,
            border: "1px solid var(--ft-border)",
            background: "var(--ft-bg)",
            padding: "6px 12px",
            fontSize: 13,
            color: "var(--ft-text)",
            outline: "none",
          }}
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--ft-border)" }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "var(--ft-surface)", borderBottom: "1px solid var(--ft-border)" }}>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Category</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Income (R)</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Expense (R)</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Margin (R)</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Head Count</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Margin / Head</th>
            </tr>
          </thead>
          <tbody>
            {categoriesToShow.map((row, idx) => {
              const isExpanded =
                expandedCategories.has(row.category) || (normalizedQuery !== '' && row.forceExpand);
              const categoryAnimals = (animalData ?? []).filter((a) => {
                if (a.category !== row.category) return false
                if (!normalizedQuery) return true
                return (
                  a.tagNumber.toLowerCase().includes(normalizedQuery) ||
                  (a.name?.toLowerCase() ?? '').includes(normalizedQuery)
                )
              });

              return (
                <React.Fragment key={row.category}>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--ft-border)",
                      background: idx % 2 === 0 ? "#FFFFFF" : "var(--ft-bg)",
                    }}
                  >
                    <td className="px-3 py-2.5 font-medium" style={{ color: "var(--ft-text)" }}>
                      <span className="flex items-center gap-1.5">
                        <button
                          onClick={() => toggleCategory(row.category)}
                          className="shrink-0 transition-colors"
                          style={{ color: "var(--ft-subtle)" }}
                          aria-label={isExpanded ? `Collapse ${row.category}` : `Expand ${row.category}`}
                        >
                          <svg
                            className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </button>
                        {row.category}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: "var(--ft-good)" }}>
                      {fmt(row.income)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: "var(--ft-poor)" }}>
                      {fmt(row.expense)}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right font-mono font-semibold"
                      style={{ color: row.margin >= 0 ? "var(--ft-good)" : "var(--ft-poor)" }}
                    >
                      {row.margin >= 0 ? "" : "-"}{fmt(row.margin)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: "var(--ft-text)" }}>
                      {row.headCount}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right font-mono"
                      style={{ color: row.marginPerHead >= 0 ? "var(--ft-good)" : "var(--ft-poor)" }}
                    >
                      {row.marginPerHead >= 0 ? "" : "-"}{fmt(row.marginPerHead)}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr key={`${row.category}-expand`}>
                      <td colSpan={6} style={{ background: "var(--ft-surface)", borderBottom: "1px solid var(--ft-border)" }}>
                        <div className="px-6 py-3">
                          {fetchError && !animalData ? (
                            <p style={{ fontSize: 13, color: "var(--ft-poor)", padding: "8px 0" }}>
                              {fetchError}
                            </p>
                          ) : loading && !animalData ? (
                            <div className="space-y-2">
                              {[1, 2, 3].map((i) => (
                                <div
                                  key={i}
                                  className="h-5 animate-pulse rounded"
                                  style={{ background: "var(--ft-border)" }}
                                />
                              ))}
                            </div>
                          ) : categoryAnimals.length === 0 ? (
                            <p className="text-xs py-1" style={{ color: "var(--ft-subtle)" }}>
                              No animals with transactions in this period.
                            </p>
                          ) : (
                            <>
                            <table className="w-full text-xs">
                              <thead>
                                <tr style={{ borderBottom: "1px solid var(--ft-border)" }}>
                                  <th className="text-left py-1 pr-3 font-semibold" style={{ color: "var(--ft-subtle)" }}>Tag</th>
                                  <th className="text-left py-1 pr-3 font-semibold" style={{ color: "var(--ft-subtle)" }}>Name</th>
                                  <th className="text-right py-1 pr-3 font-semibold" style={{ color: "var(--ft-subtle)" }}>Income</th>
                                  <th className="text-right py-1 pr-3 font-semibold" style={{ color: "var(--ft-subtle)" }}>
                                    Expenses{" "}
                                    <span
                                      title="Camp-level expenses (feed, dip, vet) are split equally across animals present in that camp."
                                      className="cursor-help"
                                      style={{ color: "var(--ft-subtle)" }}
                                    >
                                      ⓘ
                                    </span>
                                  </th>
                                  <th className="text-right py-1 font-semibold" style={{ color: "var(--ft-subtle)" }}>Margin</th>
                                </tr>
                              </thead>
                              <tbody>
                                {categoryAnimals.map((animal) => (
                                  <tr
                                    key={animal.animalId}
                                    style={{ borderBottom: "1px solid rgba(224,213,200,0.4)" }}
                                  >
                                    <td className="py-1 pr-3 font-mono" style={{ color: "var(--ft-text)" }}>
                                      {animal.tagNumber}
                                    </td>
                                    <td className="py-1 pr-3" style={{ color: "var(--ft-subtle)" }}>
                                      {animal.name ?? "—"}
                                    </td>
                                    <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--ft-good)" }}>
                                      {animal.income === 0 ? "—" : fmt(animal.income)}
                                    </td>
                                    <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--ft-poor)" }}>
                                      {animal.expenses === 0 ? "—" : fmt(animal.expenses)}
                                    </td>
                                    <td
                                      className="py-1 text-right font-mono font-semibold"
                                      style={{
                                        color:
                                          animal.income === 0 && animal.expenses === 0
                                            ? "var(--ft-subtle)"
                                            : animal.margin >= 0
                                            ? "var(--ft-good)"
                                            : "var(--ft-poor)",
                                      }}
                                    >
                                      {animal.income === 0 && animal.expenses === 0
                                        ? "—"
                                        : `${animal.margin < 0 ? "-" : ""}${fmt(animal.margin)}`}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p style={{ fontSize: 11, color: "var(--ft-subtle)", marginTop: 6 }}>
                              * Per-animal margins include pro-rata camp expenses. Category totals show direct animal transactions only.
                            </p>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
