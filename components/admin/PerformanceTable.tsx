"use client";
import { useState } from "react";
import Link from "next/link";

export interface PerfRow {
  campId: string;
  campName: string;
  animalCount: number;
  sizeHectares: number | null;
  stockingDensity: string | null;
  grazingQuality: string | null;
  fenceStatus: string | null;
  lastInspection: string | null;
  coverCategory: string | null;
  daysGrazingRemaining: number | null;
}

type SortKey = keyof PerfRow;

function grazingColor(g: string | null) {
  if (g === "Good") return { color: "var(--ft-good)", bg: "rgba(74,124,89,0.15)" };
  if (g === "Poor") return { color: "var(--ft-poor)", bg: "rgba(160,82,45,0.15)" };
  return { color: "var(--ft-fair)", bg: "rgba(139,105,20,0.15)" };
}

function daysRemainingStyle(days: number) {
  if (days < 7) return { color: "var(--ft-poor)", bg: "rgba(192,87,76,0.12)" };
  if (days <= 14) return { color: "var(--ft-fair)", bg: "rgba(139,105,20,0.15)" };
  return { color: "var(--ft-good)", bg: "rgba(74,124,89,0.15)" };
}

function SortHeader({
  k,
  label,
  sortKey,
  asc,
  onToggle,
}: {
  k: SortKey;
  label: string;
  sortKey: SortKey;
  asc: boolean;
  onToggle: (key: SortKey) => void;
}) {
  return (
    <th
      className="text-left px-4 py-3 font-semibold cursor-pointer select-none hover:text-[var(--ft-fair)] transition-colors"
      onClick={() => onToggle(k)}
    >
      {label} {sortKey === k ? (asc ? "↑" : "↓") : ""}
    </th>
  );
}

export default function PerformanceTable({ rows, farmSlug }: { rows: PerfRow[]; farmSlug: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("campName");
  const [asc, setAsc] = useState(true);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setAsc((v) => !v);
    else { setSortKey(key); setAsc(true); }
  }

  const sorted = [...rows].sort((a, b) => {
    const va = a[sortKey] ?? "";
    const vb = b[sortKey] ?? "";
    return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  return (
    <div className="overflow-x-auto rounded-2xl" style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide" style={{ borderBottom: "1px solid var(--ft-border)", background: "var(--ft-surface)", color: "var(--ft-subtle)" }}>
          <tr>
            <SortHeader k="campName" label="Camp" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
            <SortHeader k="animalCount" label="Animals" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
            <SortHeader k="stockingDensity" label="LSU/ha" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
            <SortHeader k="grazingQuality" label="Grazing" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
            <SortHeader k="fenceStatus" label="Fence" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
            <SortHeader k="coverCategory" label="Cover" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
            <SortHeader k="daysGrazingRemaining" label="Days Remaining" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
            <SortHeader k="lastInspection" label="Last Inspection" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const gc = grazingColor(row.grazingQuality);
            return (
              <tr key={row.campId} className="admin-row" style={{ borderBottom: "1px solid var(--ft-border)" }}>
                <td className="px-4 py-3 font-semibold" style={{ color: "var(--ft-text)" }}>{row.campName}</td>
                <td className="px-4 py-3 font-mono text-right" style={{ color: "var(--ft-muted)" }}>{row.animalCount}</td>
                <td className="px-4 py-3 font-mono text-right" style={{ color: "var(--ft-muted)" }}>{row.stockingDensity ?? "—"}</td>
                <td className="px-4 py-3">
                  {row.grazingQuality ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: gc.bg, color: gc.color }}>{row.grazingQuality}</span>
                  ) : <span style={{ color: "var(--ft-subtle)" }}>—</span>}
                </td>
                <td className="px-4 py-3">
                  {row.fenceStatus ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={row.fenceStatus === "Intact"
                        ? { background: "rgba(74,124,89,0.18)", color: "var(--ft-good)" }
                        : { background: "rgba(192,87,76,0.12)", color: "var(--ft-poor)" }}>
                      {row.fenceStatus}
                    </span>
                  ) : <span style={{ color: "var(--ft-subtle)" }}>—</span>}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: "var(--ft-muted)" }}>{row.coverCategory ?? "—"}</td>
                <td className="px-4 py-3">
                  {row.daysGrazingRemaining !== null ? (
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-mono font-medium"
                      style={daysRemainingStyle(row.daysGrazingRemaining)}
                    >
                      {row.daysGrazingRemaining}d
                    </span>
                  ) : <span style={{ color: "var(--ft-subtle)" }}>—</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--ft-subtle)" }}>{row.lastInspection ?? "Never"}</td>
                <td className="px-4 py-3">
                  <Link href={`/${farmSlug}/admin/camps/${row.campId}`} className="text-xs transition-opacity hover:opacity-70" style={{ color: "var(--ft-fair)" }}>
                    Details →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
