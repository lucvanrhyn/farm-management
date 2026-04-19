"use client";

/**
 * CampPopupContent — rendered inside a Mapbox `<Popup>` when the user clicks a
 * camp polygon. Extracted from FarmMap to keep the shell ≤ 400 LOC.
 */

import { useParams } from "next/navigation";

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  Good:       { color: "#4ade80", bg: "rgba(74,222,128,0.1)" },
  Intact:     { color: "#4ade80", bg: "rgba(74,222,128,0.1)" },
  Adequate:   { color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  Fair:       { color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  Damaged:    { color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
  Poor:       { color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
  Overgrazed: { color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  Critical:   { color: "#f87171", bg: "rgba(248,113,113,0.1)" },
};

const DEFAULT_STATUS = { color: "#94a3b8", bg: "rgba(148,163,184,0.1)" };

function StatusBadge({ label, value }: { label: string; value: string }) {
  const s = STATUS_COLORS[value] ?? DEFAULT_STATUS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 8, color: "rgba(210,180,140,0.5)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          background: s.bg, color: s.color,
          border: `1px solid ${s.color}44`,
          borderRadius: 6, fontSize: 10, padding: "2px 7px", fontWeight: 600,
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.color }} />
        {value}
      </div>
    </div>
  );
}

interface Props {
  campId: string;
  campName: string;
  grazing: string;
  animalCount: number;
  sizeHectares: number | null;
  waterStatus: string;
  fenceStatus: string;
  daysSinceInspection: number | null;
}

export default function CampPopupContent({
  campId,
  campName,
  grazing,
  animalCount,
  sizeHectares,
  waterStatus,
  fenceStatus,
  daysSinceInspection,
}: Props) {
  const params = useParams();
  const farmSlug = params?.farmSlug as string | undefined;
  return (
    <div
      style={{
        background: "#1E1710",
        border: "1px solid rgba(139,105,20,0.3)",
        borderRadius: "14px",
        padding: "14px 16px",
        color: "#F5EBD4",
        minWidth: "220px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10 }}>
        <p style={{ fontWeight: 700, fontSize: 15, fontFamily: "var(--font-display, serif)", color: "#F5EBD4", margin: 0 }}>
          {campName}
        </p>
        {sizeHectares != null && (
          <span style={{ fontSize: 10, color: "rgba(210,180,140,0.5)" }}>
            {sizeHectares} ha
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div
          style={{
            display: "flex", flexDirection: "column",
            padding: "4px 10px", borderRadius: 8,
            background: "rgba(255,248,235,0.06)",
            border: "1px solid rgba(210,180,140,0.15)",
            minWidth: 56, alignItems: "center",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: "#F5EBD4", lineHeight: 1.2 }}>
            {animalCount}
          </span>
          <span style={{ fontSize: 9, color: "rgba(210,180,140,0.6)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            animals
          </span>
        </div>
        <StatusBadge label="Grazing" value={grazing} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {waterStatus !== "Unknown" && <StatusBadge label="Water" value={waterStatus} />}
        {fenceStatus !== "Unknown" && <StatusBadge label="Fence" value={fenceStatus} />}
        {daysSinceInspection != null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 8, color: "rgba(210,180,140,0.5)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Last check
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 6,
              background: daysSinceInspection <= 7 ? "rgba(74,222,128,0.1)" : daysSinceInspection <= 14 ? "rgba(251,191,36,0.1)" : "rgba(251,146,60,0.1)",
              color: daysSinceInspection <= 7 ? "#4ade80" : daysSinceInspection <= 14 ? "#fbbf24" : "#fb923c",
            }}>
              {daysSinceInspection === 0 ? "Today" : `${daysSinceInspection}d ago`}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        {farmSlug && (
          <a
            href={`/${encodeURIComponent(farmSlug)}/dashboard/camp/${encodeURIComponent(campId)}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, color: "#D2B48C", fontWeight: 600,
              textDecoration: "none", letterSpacing: "0.02em",
            }}
          >
            View Details &rarr;
          </a>
        )}
        {farmSlug && (
          <a
            href={`/${encodeURIComponent(farmSlug)}/logger/${encodeURIComponent(campId)}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, color: "#8B6914", fontWeight: 600,
              textDecoration: "none", letterSpacing: "0.02em",
            }}
          >
            Log now &rarr;
          </a>
        )}
      </div>
    </div>
  );
}
