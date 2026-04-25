// components/admin/observations-log/ObservationRow.tsx
// Single timeline entry: dot, badge, camp/animal IDs, summary line, and
// an Edit button that opens EditModal in the parent.

"use client";

import type { PrismaObservation } from "@/lib/types";
import { TYPE_BADGE, TYPE_LABEL } from "./constants";
import { parseDetails } from "./parseDetails";

interface ObservationRowProps {
  obs: PrismaObservation;
  onEdit: (obs: PrismaObservation) => void;
}

export function ObservationRow({ obs, onEdit }: ObservationRowProps) {
  const badge = TYPE_BADGE[obs.type] ?? { color: "#9C8E7A", bg: "rgba(156,142,122,0.12)" };
  return (
    <div
      className="relative flex items-start gap-4 pl-6 py-2.5 transition-colors group rounded-lg -ml-px"
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(122,92,30,0.04)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {/* Timeline dot */}
      <div
        className="absolute left-0 top-[14px] w-2.5 h-2.5 rounded-full shrink-0 -translate-x-[6px]"
        style={{ background: badge.color, border: "2px solid #FFFFFF", boxShadow: `0 0 0 1px ${badge.color}` }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: badge.bg, color: badge.color }}
          >
            {TYPE_LABEL[obs.type] ?? obs.type}
          </span>
          <span className="text-xs font-semibold font-mono" style={{ color: "#1C1815" }}>
            {obs.campId}
          </span>
          {obs.animalId && (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: "#F5F2EE", color: "#6B5C4E" }}>
              {obs.animalId}
            </span>
          )}
        </div>
        <p className="text-xs mt-1 truncate" style={{ color: "#9C8E7A" }}>
          {parseDetails(obs.details, obs.type)}
          {obs.editedAt && (
            <span className="ml-1" style={{ color: "#8B6914" }} title={`Edited by ${obs.editedBy ?? "?"}`}>✎</span>
          )}
        </p>
        <p className="text-[10px] mt-0.5 font-mono" style={{ color: "#C4B8AA" }}>
          {obs.observedAt.split("T")[0]}{obs.loggedBy ? ` · ${obs.loggedBy}` : ""}
        </p>
      </div>
      <button
        onClick={() => onEdit(obs)}
        className="shrink-0 px-2.5 py-1 text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          border: "1px solid #E0D5C8",
          color: "#9C8E7A",
          background: "transparent",
        }}
      >
        Edit
      </button>
    </div>
  );
}
