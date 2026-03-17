"use client";

import { Popup } from "react-leaflet";
import type { Camp } from "@/lib/types";
import type { CampStats } from "@/lib/types";

interface Props {
  camp: Camp;
  stats: CampStats;
  grazing: string;
}

const GRAZING_COLORS: Record<string, string> = {
  Good:       "#4ade80",
  Fair:       "#fbbf24",
  Poor:       "#fb923c",
  Overgrazed: "#f87171",
};

const GRAZING_BG: Record<string, string> = {
  Good:       "rgba(74,222,128,0.1)",
  Fair:       "rgba(251,191,36,0.1)",
  Poor:       "rgba(251,146,60,0.1)",
  Overgrazed: "rgba(248,113,113,0.1)",
};

export default function CampPopup({ camp, stats, grazing }: Props) {
  const color = GRAZING_COLORS[grazing] ?? "#fbbf24";
  const bg    = GRAZING_BG[grazing]    ?? "rgba(251,191,36,0.1)";

  return (
    <Popup closeButton={false} className="farm-popup">
      <div
        style={{
          background: "#1E1710",
          border: "1px solid rgba(139,105,20,0.3)",
          borderRadius: "14px",
          padding: "14px 16px",
          color: "#F5EBD4",
          minWidth: "180px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {/* Camp name */}
        <p style={{
          fontWeight: 700,
          fontSize: "15px",
          marginBottom: "8px",
          fontFamily: "var(--font-display, serif)",
          color: "#F5EBD4",
        }}>
          {camp.camp_name}
        </p>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {/* Animal count */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            padding: "4px 10px",
            borderRadius: 8,
            background: "rgba(255,248,235,0.06)",
            border: "1px solid rgba(210,180,140,0.15)",
            minWidth: 56,
            alignItems: "center",
          }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#F5EBD4", lineHeight: 1.2 }}>
              {stats.total}
            </span>
            <span style={{ fontSize: 9, color: "rgba(210,180,140,0.6)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              animals
            </span>
          </div>

          {/* Grazing quality */}
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: bg,
            color: color,
            border: `1px solid ${color}44`,
            borderRadius: 8,
            fontSize: "11px",
            padding: "4px 10px",
            fontWeight: 600,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
            {grazing}
          </div>
        </div>

        {/* Log now link */}
        <a
          href={`/logger/${encodeURIComponent(camp.camp_id)}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: "11px",
            color: "#8B6914",
            fontWeight: 600,
            textDecoration: "none",
            padding: "4px 0",
            letterSpacing: "0.02em",
          }}
        >
          Log now →
        </a>
      </div>
    </Popup>
  );
}
