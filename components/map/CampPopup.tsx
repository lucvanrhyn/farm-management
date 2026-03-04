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
  Good: "#22c55e",
  Fair: "#eab308",
  Poor: "#f97316",
  Overgrazed: "#ef4444",
};

export default function CampPopup({ camp, stats, grazing }: Props) {
  return (
    <Popup
      closeButton={false}
      className="farm-popup"
    >
      <div
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: "10px",
          padding: "10px 14px",
          color: "#f1f5f9",
          minWidth: "160px",
        }}
      >
        <p style={{ fontWeight: 700, fontSize: "14px", marginBottom: "6px" }}>{camp.camp_name}</p>
        <p style={{ color: "#94a3b8", fontSize: "12px", marginBottom: "4px" }}>
          {stats.total} diere
        </p>
        <span
          style={{
            display: "inline-block",
            background: GRAZING_COLORS[grazing] + "33",
            color: GRAZING_COLORS[grazing],
            border: `1px solid ${GRAZING_COLORS[grazing]}55`,
            borderRadius: "6px",
            fontSize: "11px",
            padding: "2px 8px",
            fontWeight: 600,
          }}
        >
          {grazing}
        </span>
      </div>
    </Popup>
  );
}
