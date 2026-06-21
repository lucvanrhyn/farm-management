"use client";

/**
 * components/admin/profitability/ProfitabilityClient.tsx
 *
 * The client host for the dedicated /admin/profitability page (CONTEXT.md
 * "Profitability section" + "Grouping axis"). The page itself stays a SERVER
 * component (it needs requireSession / getFarmCreds / getPrismaForFarm); this
 * component owns ONLY the interactive grouping-axis toggle and renders the
 * per-axis table over the server-fetched data.
 *
 * Three axes ship because each has data on day one (CONTEXT.md "Grouping axis"):
 *   - Animal   — the per-head disposed-inclusive view (realised + projected).
 *   - Category — the same rows rolled up by Animal.category (Bull/Cow/…).
 *   - Camp     — the server <ProfitPerCampSection> (last-camp attribution),
 *                passed in as the `campSection` slot (it self-fetches).
 *
 * Honesty discipline (ADR-0012, mirrored from the view): REALISED margin and
 * PROJECTED margin live in DISTINCT columns. Projected is for live animals only
 * and is never summed with realised income — the two are visually separated and
 * the projected column is explicitly labelled "Projected".
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Pill, Segmented, type SegmentedOption } from "@/components/ds";
import type { AnimalProfitabilityViewRow } from "@/lib/domain/transactions/animal-profitability-view";

/** Axis the grouping toggle can select. */
export type ProfitAxis = "animal" | "category" | "camp";

/**
 * One rolled-up category row. Realised columns sum across the disposed-inclusive
 * roster; the projected column sums ONLY the live (Active) animals' projected
 * value — disposed animals carry `projectedValue: null` and are skipped, so
 * projected is never contaminated with a banked realised figure.
 */
export interface CategoryRollupRow {
  category: string;
  headCount: number;
  income: number;
  expenses: number;
  realisedMargin: number;
  /** Σ projectedValue over live animals in this category (null contributors skipped). */
  projectedValue: number;
  /** Σ projectedMargin over live animals in this category. */
  projectedMargin: number;
  /** How many animals in this category contributed a projected figure. */
  projectedCount: number;
}

/**
 * Pure category rollup. Aggregates the per-animal view rows by `category`.
 * Realised totals span every status; projected totals include ONLY rows that
 * carry a (non-null) projected value — i.e. live animals — so a category's
 * projected figure is never inflated by disposed members. Stable output order:
 * descending realised margin, then category name ascending.
 *
 * Exported (and pure) so it is unit-testable without rendering.
 */
export function rollUpProfitByCategory(
  rows: ReadonlyArray<AnimalProfitabilityViewRow>,
): CategoryRollupRow[] {
  const byCategory = new Map<string, CategoryRollupRow>();
  for (const r of rows) {
    const key = r.category && r.category.trim() !== "" ? r.category : "Uncategorised";
    let agg = byCategory.get(key);
    if (!agg) {
      agg = {
        category: key,
        headCount: 0,
        income: 0,
        expenses: 0,
        realisedMargin: 0,
        projectedValue: 0,
        projectedMargin: 0,
        projectedCount: 0,
      };
      byCategory.set(key, agg);
    }
    agg.headCount += 1;
    agg.income += r.income;
    agg.expenses += r.expenses;
    agg.realisedMargin += r.realisedMargin;
    // Only live animals carry a projected figure; disposed rows are null and skipped.
    if (r.projectedValue != null) {
      agg.projectedValue += r.projectedValue;
      agg.projectedMargin += r.projectedMargin ?? 0;
      agg.projectedCount += 1;
    }
  }
  return [...byCategory.values()].sort(
    (a, b) => b.realisedMargin - a.realisedMargin || a.category.localeCompare(b.category),
  );
}

/** One compact underperformer row, pre-narrated on the server (presentation-only). */
export interface UnderperformerRow {
  animalId: string;
  severity: "red" | "amber";
  reasonLabels: string[];
  narration: string;
  advisory?: string;
}

interface Props {
  farmSlug: string;
  rows: AnimalProfitabilityViewRow[];
  underperformers: UnderperformerRow[];
  /** The server <ProfitPerCampSection> (self-fetching) for the Camp axis. */
  campSection: React.ReactNode;
  /** Default axis — Camp on a populated farm (it has the richest data on trio-b). */
  defaultAxis?: ProfitAxis;
}

const AXIS_OPTIONS: ReadonlyArray<SegmentedOption<ProfitAxis>> = [
  { value: "animal", label: "Animal" },
  { value: "category", label: "Category" },
  { value: "camp", label: "Camp" },
];

function fmtR(n: number): string {
  return `R ${Math.round(Math.abs(n)).toLocaleString("en-ZA")}`;
}

function signed(n: number): string {
  return `${n < 0 ? "-" : ""}${fmtR(n)}`;
}

function marginColor(n: number): string {
  return n >= 0 ? "var(--ft-good)" : "var(--ft-poor)";
}

/** Distinct PROJECTED cell — muted styling + em-dash for non-projectable (disposed) rows. */
function ProjectedCell({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span className="font-mono" style={{ color: "var(--ft-subtle)" }} title="Realised only — animal is sold/deceased/culled">
        —
      </span>
    );
  }
  return (
    <span className="font-mono" style={{ color: marginColor(value) }}>
      {signed(value)}
    </span>
  );
}

function AnimalTable({ farmSlug, rows }: { farmSlug: string; rows: AnimalProfitabilityViewRow[] }) {
  if (rows.length === 0) {
    return (
      <Card style={{ padding: "var(--ft-card-pad)" }}>
        <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>
          No animals on the roster yet. Import or add animals to see per-head profitability.
        </p>
      </Card>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--ft-border)" }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ background: "var(--ft-surface)", borderBottom: "1px solid var(--ft-border)" }}>
            <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Tag</th>
            <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Name</th>
            <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Category</th>
            <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Status</th>
            <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Income</th>
            <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Expenses</th>
            <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Realised margin</th>
            <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-fair)" }}>
              Projected margin{" "}
              <span
                title="Estimate for animals still on the farm — never a banked sale. Sold/deceased/culled animals show — (realised only)."
                className="cursor-help"
              >
                ⓘ
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={r.animalId}
              style={{
                borderBottom: "1px solid var(--ft-border)",
                background: idx % 2 === 0 ? "#FFFFFF" : "var(--ft-bg)",
              }}
            >
              <td className="px-3 py-2 font-mono">
                <Link
                  href={`/${farmSlug}/admin/animals/${r.animalId}`}
                  style={{ color: "var(--ft-text)", textDecoration: "none" }}
                >
                  {r.tagNumber}
                </Link>
              </td>
              <td className="px-3 py-2" style={{ color: "var(--ft-subtle)" }}>{r.name ?? "—"}</td>
              <td className="px-3 py-2" style={{ color: "var(--ft-text)" }}>{r.category || "—"}</td>
              <td className="px-3 py-2" style={{ color: "var(--ft-subtle)" }}>{r.status}</td>
              <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--ft-good)" }}>
                {r.income === 0 ? "—" : fmtR(r.income)}
              </td>
              <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--ft-poor)" }}>
                {r.expenses === 0 ? "—" : fmtR(r.expenses)}
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: marginColor(r.realisedMargin) }}>
                {signed(r.realisedMargin)}
              </td>
              <td className="px-3 py-2 text-right">
                <ProjectedCell value={r.projectedMargin} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2" style={{ fontSize: 11, color: "var(--ft-subtle)" }}>
        Realised margin = tagged income − expenses to date. Projected margin estimates the
        live animal&apos;s sale value against expenses so far; it is shown separately and never
        added to realised income.
      </p>
    </div>
  );
}

function CategoryTable({ rows }: { rows: AnimalProfitabilityViewRow[] }) {
  const categories = useMemo(() => rollUpProfitByCategory(rows), [rows]);
  if (categories.length === 0) {
    return (
      <Card style={{ padding: "var(--ft-card-pad)" }}>
        <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>
          No categories to roll up yet.
        </p>
      </Card>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--ft-border)" }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ background: "var(--ft-surface)", borderBottom: "1px solid var(--ft-border)" }}>
            <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Category</th>
            <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Head</th>
            <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Income</th>
            <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Expenses</th>
            <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-subtle)" }}>Realised margin</th>
            <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--ft-fair)" }}>
              Projected margin{" "}
              <span title="Σ of live animals' projected margin in this category (sold/deceased/culled members excluded)." className="cursor-help">
                ⓘ
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c, idx) => (
            <tr
              key={c.category}
              style={{
                borderBottom: "1px solid var(--ft-border)",
                background: idx % 2 === 0 ? "#FFFFFF" : "var(--ft-bg)",
              }}
            >
              <td className="px-3 py-2.5 font-medium" style={{ color: "var(--ft-text)" }}>{c.category}</td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: "var(--ft-text)" }}>{c.headCount}</td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: "var(--ft-good)" }}>
                {c.income === 0 ? "—" : fmtR(c.income)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: "var(--ft-poor)" }}>
                {c.expenses === 0 ? "—" : fmtR(c.expenses)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono font-semibold" style={{ color: marginColor(c.realisedMargin) }}>
                {signed(c.realisedMargin)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: c.projectedCount === 0 ? "var(--ft-subtle)" : marginColor(c.projectedMargin) }}>
                {c.projectedCount === 0 ? "—" : signed(c.projectedMargin)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnderperformerPanel({ farmSlug, items }: { farmSlug: string; items: UnderperformerRow[] }) {
  return (
    <Card style={{ padding: "var(--ft-card-pad)" }}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
            Underperformers
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--ft-subtle)" }}>
            Open cows, money-losers &amp; repeatedly-treated animals worth a closer look.
          </p>
        </div>
        <Link
          href={`/${farmSlug}/admin/triage`}
          className="ft-mono"
          style={{ fontSize: 12, color: "var(--ft-subtle)", textDecoration: "none" }}
        >
          Full triage →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>
          No underperformers flagged. Tag income &amp; costs to animals to surface money-losers.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => {
            const accent = it.severity === "red" ? "var(--ft-crit)" : "var(--ft-fair)";
            return (
              <Link
                key={it.animalId}
                href={`/${farmSlug}/admin/animals/${it.animalId}`}
                className="ft-card ft-card-lift block"
                style={{ padding: "10px 12px", borderLeft: `3px solid ${accent}`, textDecoration: "none" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="ft-mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--ft-text)" }}>
                    {it.animalId}
                  </span>
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {it.reasonLabels.map((label) => (
                      <Pill key={label} tone={it.severity === "red" ? "crit" : "fair"}>
                        {label}
                      </Pill>
                    ))}
                  </span>
                </div>
                <p className="mt-1.5" style={{ fontSize: 12.5, color: "var(--ft-muted)" }}>
                  {it.narration}
                  {it.advisory ? (
                    <span
                      className="ft-mono"
                      title={it.advisory}
                      style={{
                        marginLeft: 6,
                        fontSize: 11,
                        letterSpacing: ".03em",
                        textTransform: "uppercase",
                        color: "var(--ft-subtle)",
                      }}
                    >
                      (advisory)
                    </span>
                  ) : null}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function ProfitabilityClient({
  farmSlug,
  rows,
  underperformers,
  campSection,
  defaultAxis = "camp",
}: Props) {
  const [axis, setAxis] = useState<ProfitAxis>(defaultAxis);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="ft-mono"
          style={{ fontSize: 11.5, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ft-subtle)" }}
        >
          Group by
        </span>
        <Segmented aria-label="Group by" value={axis} onChange={setAxis} options={AXIS_OPTIONS} />
      </div>

      {axis === "animal" && <AnimalTable farmSlug={farmSlug} rows={rows} />}
      {axis === "category" && <CategoryTable rows={rows} />}
      {axis === "camp" && <div>{campSection}</div>}

      <UnderperformerPanel farmSlug={farmSlug} items={underperformers} />
    </div>
  );
}
