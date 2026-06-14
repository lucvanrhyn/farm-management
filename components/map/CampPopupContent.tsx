"use client";

/**
 * CampPopupContent — rendered inside a Mapbox `<Popup>` when the user clicks a
 * camp polygon. Extracted from FarmMap to keep the shell ≤ 400 LOC.
 *
 * Reskin (satellite / immersive): dark-glass card, Fraunces camp name,
 * token-driven status pills. The popup floats over the dark satellite map
 * (outside any .dark-surface scope) so it carries literal dark-glass values.
 * Props / contract / links unchanged — visual only.
 */

import { useParams } from "next/navigation";

// Map a status word to the design status scale (good / fair / poor / critical).
const STATUS_TONE: Record<string, "good" | "fair" | "poor" | "critical"> = {
  Good:       "good",
  Intact:     "good",
  Adequate:   "fair",
  Fair:       "fair",
  Damaged:    "poor",
  Poor:       "poor",
  Overgrazed: "critical",
  Critical:   "critical",
};

const TONE_COLOR: Record<"good" | "fair" | "poor" | "critical", string> = {
  good:     "var(--ft-good)",
  fair:     "var(--ft-fair)",
  poor:     "var(--ft-poor)",
  critical: "var(--ft-crit)",
};

const DEFAULT_COLOR = "#B6A993";

function StatusBadge({ label, value }: { label: string; value: string }) {
  const tone = STATUS_TONE[value];
  const color = tone ? TONE_COLOR[tone] : DEFAULT_COLOR;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        className="ft-mono"
        style={{ fontSize: 8, color: "rgba(255,235,210,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}
      >
        {label}
      </span>
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "rgba(255,235,210,0.06)", color,
          border: `1px solid ${color}55`,
          borderRadius: 999, fontSize: 10.5, padding: "3px 9px", fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 0 3px ${color}26` }} />
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

  const lastCheckColor =
    daysSinceInspection == null
      ? DEFAULT_COLOR
      : daysSinceInspection <= 7
        ? "var(--ft-good)"
        : daysSinceInspection <= 14
          ? "var(--ft-fair)"
          : "var(--ft-poor)";

  return (
    <div
      style={{
        background: "rgba(26,21,16,0.92)",
        border: "1px solid rgba(255,235,210,0.13)",
        backdropFilter: "blur(14px) saturate(140%)",
        borderRadius: 16,
        padding: "16px 18px",
        color: "#EFE7D8",
        minWidth: 220,
        boxShadow: "0 10px 36px -12px rgba(0,0,0,0.6)",
      }}
    >
      <div className="ft-mono" style={{ fontSize: 10, letterSpacing: "0.16em", color: "rgba(255,235,210,0.5)", textTransform: "uppercase" }}>
        Camp
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3, marginBottom: 12 }}>
        <p className="ft-serif" style={{ fontWeight: 500, fontSize: 22, color: "#EFE7D8", margin: 0, lineHeight: 1.05 }}>
          {campName}
        </p>
        {sizeHectares != null && (
          <span className="ft-mono" style={{ fontSize: 10.5, color: "rgba(255,235,210,0.5)" }}>
            {sizeHectares} ha
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div
          style={{
            display: "flex", flexDirection: "column",
            padding: "6px 12px", borderRadius: 10,
            background: "rgba(42,35,28,0.9)",
            border: "1px solid rgba(255,235,210,0.1)",
            minWidth: 56, alignItems: "center",
          }}
        >
          <span className="ft-mono ft-tabnums" style={{ fontSize: 17, fontWeight: 500, color: "#EFE7D8", lineHeight: 1.2 }}>
            {animalCount}
          </span>
          <span className="ft-mono" style={{ fontSize: 9, color: "rgba(255,235,210,0.6)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            animals
          </span>
        </div>
        <StatusBadge label="Grazing" value={grazing} />
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {waterStatus !== "Unknown" && <StatusBadge label="Water" value={waterStatus} />}
        {fenceStatus !== "Unknown" && <StatusBadge label="Fence" value={fenceStatus} />}
        {daysSinceInspection != null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="ft-mono" style={{ fontSize: 8, color: "rgba(255,235,210,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Last check
            </span>
            <span
              className="ft-mono"
              style={{
                fontSize: 10.5, fontWeight: 500, padding: "3px 9px", borderRadius: 999,
                background: "rgba(255,235,210,0.06)",
                border: `1px solid ${lastCheckColor}55`,
                color: lastCheckColor,
                whiteSpace: "nowrap",
              }}
            >
              {daysSinceInspection === 0 ? "Today" : `${daysSinceInspection}d ago`}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 18 }}>
        {farmSlug && (
          <a
            href={`/${encodeURIComponent(farmSlug)}/dashboard/camp/${encodeURIComponent(campId)}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11.5, color: "var(--ft-accent)", fontWeight: 500,
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
              fontSize: 11.5, color: "rgba(255,235,210,0.7)", fontWeight: 500,
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
