"use client";

import { useState, useMemo } from "react";
import type {
  ProfitPerCampRow,
  UnallocatedSummary,
} from "@/lib/calculators/profit-per-camp";

type SortKey = "profit" | "profitPerLsu" | "profitPerHa";

function fmtR(n: number): string {
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

/** Per-LSU / per-ha figures: rand value or em-dash when null. */
function fmtROrDash(n: number | null): string {
  return n === null ? "—" : `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

/** Profit colour: positive = good, negative = poor, zero = subtle. */
function profitColor(n: number): string {
  if (n > 0) return "var(--ft-good)";
  if (n < 0) return "var(--ft-poor)";
  return "var(--ft-subtle)";
}

/**
 * Sort rows by the chosen metric. Null metric values sort last regardless of
 * direction so an unrankable camp never displaces a ranked one.
 */
function sortRows(
  rows: ReadonlyArray<ProfitPerCampRow>,
  key: SortKey,
  dir: "asc" | "desc",
): ProfitPerCampRow[] {
  const factor = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * factor;
  });
}

export default function ProfitPerCampTableClient({
  rows,
  unallocated,
}: {
  rows: ProfitPerCampRow[];
  unallocated: UnallocatedSummary;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(
    () => sortRows(rows, sortKey, dir),
    [rows, sortKey, dir],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setDir("desc");
    }
  }

  const arrow = (key: SortKey) =>
    key === sortKey ? (dir === "desc" ? " ↓" : " ↑") : "";

  const headerBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    cursor: "pointer",
    font: "inherit",
    fontWeight: 500,
    color: "inherit",
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr
            style={{
              color: "var(--ft-subtle)",
              borderBottom: "1px solid var(--ft-border)",
            }}
          >
            <th className="text-left py-2 pr-3 font-medium">Camp</th>
            <th className="text-right py-2 px-3 font-medium">Income</th>
            <th className="text-right py-2 px-3 font-medium">Cost</th>
            <th className="text-right py-2 px-3 font-medium">
              <button
                type="button"
                style={headerBtnStyle}
                onClick={() => toggleSort("profit")}
              >
                Profit{arrow("profit")}
              </button>
            </th>
            <th className="text-right py-2 px-3 font-medium">
              <button
                type="button"
                style={headerBtnStyle}
                onClick={() => toggleSort("profitPerLsu")}
              >
                /LSU{arrow("profitPerLsu")}
              </button>
            </th>
            <th className="text-right py-2 px-3 font-medium">
              <button
                type="button"
                style={headerBtnStyle}
                onClick={() => toggleSort("profitPerHa")}
              >
                /ha{arrow("profitPerHa")}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.campId}
              style={{ borderBottom: "1px solid var(--ft-surface2)" }}
            >
              <td className="py-2 pr-3" style={{ color: "var(--ft-text)" }}>
                {row.campName}
              </td>
              <td
                className="py-2 px-3 text-right font-mono"
                style={{ color: "var(--ft-text)" }}
              >
                {fmtR(row.income)}
              </td>
              <td
                className="py-2 px-3 text-right font-mono"
                style={{ color: "var(--ft-text)" }}
              >
                {fmtR(row.cost)}
              </td>
              <td
                className="py-2 px-3 text-right font-mono font-bold"
                style={{ color: profitColor(row.profit) }}
              >
                {fmtR(row.profit)}
              </td>
              <td
                className="py-2 px-3 text-right font-mono"
                style={{ color: "var(--ft-text)" }}
              >
                {fmtROrDash(row.profitPerLsu)}
              </td>
              <td
                className="py-2 px-3 text-right font-mono"
                style={{ color: "var(--ft-text)" }}
              >
                {fmtROrDash(row.profitPerHa)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "1px solid var(--ft-border)" }}>
            <td
              className="py-2 pr-3 text-xs"
              style={{ color: "var(--ft-subtle)" }}
            >
              Unallocated overhead
            </td>
            <td
              className="py-2 px-3 text-right font-mono text-xs"
              style={{ color: "var(--ft-subtle)" }}
            >
              {fmtR(unallocated.income)}
            </td>
            <td
              className="py-2 px-3 text-right font-mono text-xs"
              style={{ color: "var(--ft-subtle)" }}
            >
              {fmtR(unallocated.cost)}
            </td>
            <td
              className="py-2 px-3 text-right font-mono text-xs"
              style={{ color: profitColor(unallocated.net) }}
            >
              {fmtR(unallocated.net)}
            </td>
            <td className="py-2 px-3 text-right" style={{ color: "var(--ft-subtle)" }}>
              —
            </td>
            <td className="py-2 px-3 text-right" style={{ color: "var(--ft-subtle)" }}>
              —
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
