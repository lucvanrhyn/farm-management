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
}

type SortKey = keyof PerfRow;

function grazingColor(g: string | null) {
  if (g === "Good") return { color: "#4A7C59", bg: "rgba(74,124,89,0.15)" };
  if (g === "Poor") return { color: "#A0522D", bg: "rgba(160,82,45,0.15)" };
  return { color: "#8B6914", bg: "rgba(139,105,20,0.15)" };
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

  const H = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      className="text-left px-4 py-3 font-semibold cursor-pointer select-none hover:text-[#8B6914] transition-colors"
      onClick={() => toggleSort(k)}
    >
      {label} {sortKey === k ? (asc ? "↑" : "↓") : ""}
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-2xl" style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide" style={{ borderBottom: "1px solid #E0D5C8", background: "#F5F2EE", color: "#9C8E7A" }}>
          <tr>
            <H k="campName" label="Camp" />
            <H k="animalCount" label="Animals" />
            <H k="stockingDensity" label="LSU/ha" />
            <H k="grazingQuality" label="Grazing" />
            <H k="fenceStatus" label="Fence" />
            <H k="coverCategory" label="Cover" />
            <H k="lastInspection" label="Last Inspection" />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const gc = grazingColor(row.grazingQuality);
            return (
              <tr key={row.campId} className="admin-row" style={{ borderBottom: "1px solid #E0D5C8" }}>
                <td className="px-4 py-3 font-semibold" style={{ color: "#1C1815" }}>{row.campName}</td>
                <td className="px-4 py-3 font-mono text-right" style={{ color: "#6B5C4E" }}>{row.animalCount}</td>
                <td className="px-4 py-3 font-mono text-right" style={{ color: "#6B5C4E" }}>{row.stockingDensity ?? "—"}</td>
                <td className="px-4 py-3">
                  {row.grazingQuality ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: gc.bg, color: gc.color }}>{row.grazingQuality}</span>
                  ) : <span style={{ color: "#9C8E7A" }}>—</span>}
                </td>
                <td className="px-4 py-3">
                  {row.fenceStatus ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={row.fenceStatus === "Intact"
                        ? { background: "rgba(74,124,89,0.18)", color: "#4A7C59" }
                        : { background: "rgba(192,87,76,0.12)", color: "#C0574C" }}>
                      {row.fenceStatus}
                    </span>
                  ) : <span style={{ color: "#9C8E7A" }}>—</span>}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: "#6B5C4E" }}>{row.coverCategory ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: "#9C8E7A" }}>{row.lastInspection ?? "Never"}</td>
                <td className="px-4 py-3">
                  <Link href={`/${farmSlug}/admin/camps/${row.campId}`} className="text-xs transition-opacity hover:opacity-70" style={{ color: "#8B6914" }}>
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
