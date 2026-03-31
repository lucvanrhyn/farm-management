"use client";

import { useState } from "react";
import Link from "next/link";
import type { CampLeagueRow } from "@/lib/server/league-analytics";

type SortKey = "rank" | "avgAdg" | "headcount" | "lsuPerHa" | "condition" | "daysGrazingRemaining" | "lastInspection";

const CONDITION_COLORS: Record<string, string> = {
  Good: "#4A7C59",
  Fair: "#8B6914",
  Poor: "#C0574C",
};

function MedalBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span title="Gold">🥇</span>;
  if (rank === 2) return <span title="Silver">🥈</span>;
  if (rank === 3) return <span title="Bronze">🥉</span>;
  return <span className="font-mono text-xs" style={{ color: "#9C8E7A" }}>{rank}</span>;
}

function SortIcon({ col, sortKey, asc }: { col: SortKey; sortKey: SortKey; asc: boolean }) {
  return (
    <span className="ml-1 text-[10px]" style={{ color: sortKey === col ? "#8B6914" : "#9C8E7A" }}>
      {sortKey === col ? (asc ? "↑" : "↓") : "↕"}
    </span>
  );
}

function ThBtn({
  col,
  sortKey,
  asc,
  onSort,
  children,
}: {
  col: SortKey;
  sortKey: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onSort(col)}
      className="flex items-center gap-0.5 text-left w-full"
      style={{ color: sortKey === col ? "#8B6914" : "#9C8E7A" }}
    >
      {children}
      <SortIcon col={col} sortKey={sortKey} asc={asc} />
    </button>
  );
}

function AdgCell({ adg, threshold = 0.9 }: { adg: number | null; threshold?: number }) {
  if (adg === null) return <span style={{ color: "#9C8E7A" }}>—</span>;
  const color = adg > threshold ? "#4A7C59" : adg >= 0.7 ? "#8B6914" : "#C0574C";
  return (
    <span className="font-mono font-semibold" style={{ color }}>
      {adg.toFixed(2)}
    </span>
  );
}

interface Props {
  rows: CampLeagueRow[];
  farmSlug: string;
  campGrazingWarningDays?: number;
}

export default function LeagueTable({ rows, farmSlug, campGrazingWarningDays = 7 }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("avgAdg");
  const [asc, setAsc] = useState(false);

  const sorted = [...rows].sort((a, b) => {
    const dir = asc ? 1 : -1;
    if (sortKey === "avgAdg") {
      if (a.avgAdg === null && b.avgAdg === null) return 0;
      if (a.avgAdg === null) return 1;
      if (b.avgAdg === null) return -1;
      return dir * (a.avgAdg - b.avgAdg);
    }
    if (sortKey === "headcount") return dir * (a.headcount - b.headcount);
    if (sortKey === "lsuPerHa") {
      if (a.lsuPerHa === null && b.lsuPerHa === null) return 0;
      if (a.lsuPerHa === null) return 1;
      if (b.lsuPerHa === null) return -1;
      return dir * (a.lsuPerHa - b.lsuPerHa);
    }
    if (sortKey === "daysGrazingRemaining") {
      if (a.daysGrazingRemaining === null && b.daysGrazingRemaining === null) return 0;
      if (a.daysGrazingRemaining === null) return 1;
      if (b.daysGrazingRemaining === null) return -1;
      return dir * (a.daysGrazingRemaining - b.daysGrazingRemaining);
    }
    if (sortKey === "condition") {
      const order: Record<string, number> = { Good: 0, Fair: 1, Poor: 2 };
      const av = order[a.condition ?? ""] ?? 3;
      const bv = order[b.condition ?? ""] ?? 3;
      return dir * (av - bv);
    }
    if (sortKey === "lastInspection") {
      return dir * ((a.lastInspection ?? "").localeCompare(b.lastInspection ?? ""));
    }
    return 0;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setAsc(!asc);
    else { setSortKey(key); setAsc(false); }
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm" style={{ color: "#9C8E7A" }}>
        No camps found. Add camps and observations to see the league table.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #E0D5C8" }}>
      <table className="w-full text-sm" style={{ background: "#FFFFFF" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #E0D5C8", background: "#FAFAF8" }}>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A", width: "3rem" }}>
              <ThBtn col="rank" sortKey={sortKey} asc={asc} onSort={handleSort}>#</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              Camp
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="avgAdg" sortKey={sortKey} asc={asc} onSort={handleSort}>Avg ADG</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="headcount" sortKey={sortKey} asc={asc} onSort={handleSort}>Head</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="lsuPerHa" sortKey={sortKey} asc={asc} onSort={handleSort}>LSU/ha</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="condition" sortKey={sortKey} asc={asc} onSort={handleSort}>Condition</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="daysGrazingRemaining" sortKey={sortKey} asc={asc} onSort={handleSort}>Days Grazing</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="lastInspection" sortKey={sortKey} asc={asc} onSort={handleSort}>Last Inspection</ThBtn>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const rank = i + 1;
            const daysColor =
              row.daysGrazingRemaining !== null
                ? row.daysGrazingRemaining <= campGrazingWarningDays
                  ? "#C0574C"
                  : row.daysGrazingRemaining <= campGrazingWarningDays * 2
                  ? "#8B6914"
                  : "#4A7C59"
                : "#9C8E7A";

            return (
              <tr
                key={row.campId}
                style={{ borderBottom: "1px solid #E0D5C8" }}
                className="hover:bg-[#F5F2EE] transition-colors"
              >
                <td className="px-3 py-3 text-center">
                  {sortKey === "avgAdg" ? (
                    <MedalBadge rank={rank} />
                  ) : (
                    <span className="font-mono text-xs" style={{ color: "#9C8E7A" }}>{rank}</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/${farmSlug}/admin/camps/${row.campId}`}
                    className="font-medium hover:underline"
                    style={{ color: "#1C1815" }}
                  >
                    {row.campName}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <AdgCell adg={row.avgAdg} />
                  {row.avgAdg !== null && (
                    <span className="ml-1 text-xs" style={{ color: "#9C8E7A" }}>kg/d</span>
                  )}
                </td>
                <td className="px-3 py-3 font-mono text-xs" style={{ color: "#1C1815" }}>
                  {row.headcount}
                </td>
                <td className="px-3 py-3 font-mono text-xs" style={{ color: "#1C1815" }}>
                  {row.lsuPerHa !== null ? row.lsuPerHa : "—"}
                </td>
                <td className="px-3 py-3">
                  {row.condition !== null ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: CONDITION_COLORS[row.condition] ?? "#9C8E7A" }}
                      />
                      <span className="text-xs" style={{ color: "#1C1815" }}>
                        {row.condition}
                      </span>
                    </span>
                  ) : (
                    <span style={{ color: "#9C8E7A" }}>—</span>
                  )}
                </td>
                <td className="px-3 py-3 font-mono text-xs" style={{ color: daysColor }}>
                  {row.daysGrazingRemaining !== null ? `${row.daysGrazingRemaining}d` : "—"}
                </td>
                <td className="px-3 py-3 font-mono text-xs" style={{ color: "#9C8E7A" }}>
                  {row.lastInspection ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
