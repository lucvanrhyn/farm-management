"use client";

import type { Camp } from "@/lib/types";
import type { LiveCampStatus } from "@/lib/server/camp-status";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FilterMode = "grazing" | "water" | "density" | "days";

interface Props {
  onCampClick: (campId: string) => void;
  filterBy: FilterMode;
  selectedCampId: string | null;
  liveConditions?: Record<string, LiveCampStatus>;
  camps: Camp[];
  campAnimalCounts: Record<string, number>;
}

// ─── Logical canvas dimensions ────────────────────────────────────────────────

const CANVAS_W = 1100;
const CANVAS_H = 630;

// ─── Camp center positions (cx, cy in logical canvas pixels) ──────────────────
// Organic layout: roughly 4-col × 5-row grid with deliberate offsets

const CAMP_CENTERS: Record<string, { cx: number; cy: number }> = {
  "I-1":             { cx: 90,  cy: 80  },
  "I-3":             { cx: 352, cy: 72  },
  "A":               { cx: 584, cy: 85  },
  "B":               { cx: 848, cy: 82  },
  "C":               { cx: 95,  cy: 205 },
  "D":               { cx: 330, cy: 198 },
  "Teerlings":       { cx: 596, cy: 192 },
  "Sirkel":          { cx: 832, cy: 203 },
  "Bulle":           { cx: 100, cy: 315 },
  "H":               { cx: 335, cy: 325 },
  "Uithoek":         { cx: 598, cy: 310 },
  "Wildskamp":       { cx: 828, cy: 320 },
  "Bloukom":         { cx: 93,  cy: 435 },
  "Ben se Huis":     { cx: 350, cy: 427 },
  "Everlyn":         { cx: 584, cy: 440 },
  "Praalhoek":       { cx: 845, cy: 428 },
  "Praalhoek Verse": { cx: 98,  cy: 548 },
  "B4":              { cx: 336, cy: 554 },
  "B1":              { cx: 600, cy: 546 },
};

// Adjacent camp pairs for "farm road" lines
const ROAD_PAIRS: [string, string][] = [
  // Row connections
  ["I-1", "I-3"], ["I-3", "A"], ["A", "B"],
  ["C", "D"], ["D", "Teerlings"], ["Teerlings", "Sirkel"],
  ["Bulle", "H"], ["H", "Uithoek"], ["Uithoek", "Wildskamp"],
  ["Bloukom", "Ben se Huis"], ["Ben se Huis", "Everlyn"], ["Everlyn", "Praalhoek"],
  ["Praalhoek Verse", "B4"], ["B4", "B1"],
  // Column connections
  ["I-1", "C"], ["C", "Bulle"], ["Bulle", "Bloukom"], ["Bloukom", "Praalhoek Verse"],
  ["I-3", "D"], ["D", "H"], ["H", "Ben se Huis"], ["Ben se Huis", "B4"],
  ["A", "Teerlings"], ["Teerlings", "Uithoek"], ["Uithoek", "Everlyn"], ["Everlyn", "B1"],
  ["B", "Sirkel"], ["Sirkel", "Wildskamp"], ["Wildskamp", "Praalhoek"],
];

// ─── Size helper ──────────────────────────────────────────────────────────────

function campSize(ha: number): { w: number; h: number } {
  const w = Math.round(90 + ((ha - 60) / (245 - 60)) * 80);
  const h = Math.round(w * 0.58);
  return { w, h };
}

// ─── Color helpers ────────────────────────────────────────────────────────────

// Camp block colors — border + light bg tint (designed for white/cream canvas)
const WARM = {
  good:  { border: "#4A7C59", bg: "rgba(74,124,89,0.08)",   text: "#3A6A48", label: "Good"      },
  fair:  { border: "#8B6914", bg: "rgba(139,105,20,0.08)",  text: "#6B4E10", label: "Fair"   },
  poor:  { border: "#A0522D", bg: "rgba(160,82,45,0.10)",   text: "#7A3A18", label: "Poor"      },
  bad:   { border: "#8B3A3A", bg: "rgba(139,58,58,0.12)",   text: "#8B1A1A", label: "Critical"   },
  water: { border: "#3B7A8B", bg: "rgba(59,122,139,0.08)",  text: "#2A6070", label: "Full"       },
};

function getCampColors(
  filterBy: FilterMode,
  liveCondition: LiveCampStatus | undefined,
  animalCount: number,
  sizeHectares: number | undefined,
) {
  if (filterBy === "grazing") {
    const q = liveCondition?.grazing_quality ?? "Fair";
    if (q === "Good")  return WARM.good;
    if (q === "Fair")  return WARM.fair;
    if (q === "Poor")  return WARM.poor;
    return WARM.bad;
  }

  if (filterBy === "water") {
    const w = liveCondition?.water_status ?? "Full";
    if (w === "Full")  return WARM.water;
    if (w === "Low")   return WARM.fair;
    if (w === "Empty") return WARM.poor;
    return WARM.bad;
  }

  if (filterBy === "density") {
    const d = animalCount / (sizeHectares ?? 1);
    if (d < 0.25)  return WARM.good;
    if (d < 0.38)  return WARM.fair;
    if (d < 0.50)  return WARM.poor;
    return WARM.bad;
  }

  // days since inspection
  if (liveCondition?.last_inspected_at) {
    const inspected = new Date(liveCondition.last_inspected_at);
    const days = Math.floor((Date.now() - inspected.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return WARM.good;
    if (days === 1) return WARM.fair;
    if (days <= 3)  return WARM.poor;
    return WARM.bad;
  }
  return WARM.bad; // No inspection data
}

// ─── Water source icon ────────────────────────────────────────────────────────

function WaterIcon({ source }: { source: string }) {
  const icons: Record<string, string> = {
    borehole: "⬤",
    dam:      "≋",
    river:    "〜",
    trough:   "⊓",
  };
  return (
    <span style={{ fontSize: 9, opacity: 0.7, letterSpacing: 0 }}>
      {icons[source] ?? "·"}
    </span>
  );
}

// ─── Compass Rose ─────────────────────────────────────────────────────────────

function CompassRose() {
  const amber = "#5C3D2E";
  const tan = "rgba(92,61,46,0.45)";
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      {/* Outer ring */}
      <circle cx="32" cy="32" r="28" fill="none" stroke={tan} strokeWidth="0.75" />
      <circle cx="32" cy="32" r="3" fill={amber} />
      {/* Cardinal ticks */}
      {[0, 90, 180, 270].map((deg) => (
        <line
          key={deg}
          x1="32" y1="6" x2="32" y2="12"
          stroke={amber} strokeWidth="1.5"
          transform={`rotate(${deg} 32 32)`}
        />
      ))}
      {/* N arrow */}
      <polygon points="32,8 29,22 32,19 35,22" fill={amber} />
      <polygon points="32,56 29,42 32,45 35,42" fill={tan} />
      <line x1="8" y1="32" x2="56" y2="32" stroke={tan} strokeWidth="0.75" />
      {/* Cardinal labels */}
      <text x="32" y="5" textAnchor="middle" fill={amber} fontSize="7" fontFamily="var(--font-sans)" fontWeight="600">N</text>
      <text x="32" y="61" textAnchor="middle" fill={tan} fontSize="6" fontFamily="var(--font-sans)">S</text>
      <text x="61" y="34" textAnchor="middle" fill={tan} fontSize="6" fontFamily="var(--font-sans)">E</text>
      <text x="3"  y="34" textAnchor="middle" fill={tan} fontSize="6" fontFamily="var(--font-sans)">W</text>
    </svg>
  );
}

// ─── Topographic SVG underlay ─────────────────────────────────────────────────

function TopoUnderlay({ campCenters }: { campCenters: typeof CAMP_CENTERS }) {
  const strokeColor = "rgba(92,61,46,0.09)";
  const roadColor   = "rgba(92,61,46,0.22)";

  // Contour ellipses centered on canvas
  const ellipses = [
    { rx: 520, ry: 260, rotate: -8  },
    { rx: 420, ry: 200, rotate: -12 },
    { rx: 320, ry: 150, rotate: -6  },
    { rx: 220, ry: 105, rotate: -10 },
    { rx: 130, ry: 65,  rotate: -8  },
  ];

  return (
    <svg
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    >
      <defs>
        <radialGradient id="terrainGlow1" cx="30%" cy="35%" r="45%">
          <stop offset="0%"   stopColor="rgba(92,61,46,0.07)" />
          <stop offset="100%" stopColor="rgba(92,61,46,0)" />
        </radialGradient>
        <radialGradient id="terrainGlow2" cx="72%" cy="65%" r="40%">
          <stop offset="0%"   stopColor="rgba(70,50,30,0.055)" />
          <stop offset="100%" stopColor="rgba(70,50,30,0)" />
        </radialGradient>
      </defs>

      {/* Terrain depth blobs */}
      <rect x="0" y="0" width={CANVAS_W} height={CANVAS_H} fill="url(#terrainGlow1)" />
      <rect x="0" y="0" width={CANVAS_W} height={CANVAS_H} fill="url(#terrainGlow2)" />

      {/* Topographic contour ellipses */}
      <g transform={`translate(${CANVAS_W / 2} ${CANVAS_H / 2})`}>
        {ellipses.map((e, i) => (
          <ellipse
            key={i}
            rx={e.rx} ry={e.ry}
            fill="none"
            stroke={strokeColor}
            strokeWidth="1"
            transform={`rotate(${e.rotate})`}
          />
        ))}
      </g>

      {/* Farm road lines between adjacent camps */}
      {ROAD_PAIRS.map(([a, b], i) => {
        const ca = campCenters[a];
        const cb = campCenters[b];
        if (!ca || !cb) return null;
        // Convert pixel to % of canvas for the viewBox
        return (
          <line
            key={i}
            x1={ca.cx} y1={ca.cy}
            x2={cb.cx} y2={cb.cy}
            stroke={roadColor}
            strokeWidth="1.2"
            strokeDasharray="5,8"
            strokeLinecap="round"
          />
        );
      })}

      {/* Decorative corner brackets */}
      {[
        [12, 12, 1, 1], [CANVAS_W - 12, 12, -1, 1],
        [12, CANVAS_H - 12, 1, -1], [CANVAS_W - 12, CANVAS_H - 12, -1, -1],
      ].map(([x, y, dx, dy], i) => (
        <g key={i} stroke="rgba(92,61,46,0.4)" strokeWidth="1" fill="none">
          <polyline points={`${x + dx * 18},${y} ${x},${y} ${x},${y + dy * 18}`} />
        </g>
      ))}

      {/* Outer frame */}
      <rect
        x="6" y="6"
        width={CANVAS_W - 12} height={CANVAS_H - 12}
        fill="none"
        stroke="rgba(92,61,46,0.15)"
        strokeWidth="1"
      />
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SchematicMap({ onCampClick, filterBy, selectedCampId, liveConditions = {}, camps, campAnimalCounts }: Props) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#FFFFFF",
        overflow: "auto",
      }}
    >
      {/* Logical canvas — scales via padding-bottom trick or just scrollable */}
      <div
        style={{
          position: "relative",
          width: CANVAS_W,
          height: CANVAS_H,
          minWidth: "100%",
          minHeight: "100%",
        }}
      >
        {/* SVG background layer */}
        <TopoUnderlay campCenters={CAMP_CENTERS} />

        {/* Camp blocks */}
        {camps.map((camp) => {
          const center = CAMP_CENTERS[camp.camp_id];
          if (!center) return null;

          const { w, h } = campSize(camp.size_hectares ?? 120);
          const liveCondition = liveConditions[camp.camp_id];
          const animalCount = campAnimalCounts[camp.camp_id] ?? 0;
          const colors = getCampColors(filterBy, liveCondition, animalCount, camp.size_hectares);
          const isAlert = liveCondition
            ? liveCondition.grazing_quality === "Overgrazed" || liveCondition.water_status === "Empty" || liveCondition.water_status === "Broken" || liveCondition.fence_status === "Damaged"
            : false;
          const isSelected = selectedCampId === camp.camp_id;
          const densityLabel = `${(animalCount / (camp.size_hectares ?? 1)).toFixed(2)}/ha`;
          const daysLabel = liveCondition?.last_inspected_at
            ? `${Math.floor((Date.now() - new Date(liveCondition.last_inspected_at).getTime()) / (1000 * 60 * 60 * 24))}d`
            : "—";

          const leftPct = ((center.cx - w / 2) / CANVAS_W) * 100;
          const topPct  = ((center.cy - h / 2) / CANVAS_H) * 100;
          const wPct    = (w / CANVAS_W) * 100;
          const hPct    = (h / CANVAS_H) * 100;

          return (
            <div
              key={camp.camp_id}
              onClick={() => onCampClick(camp.camp_id)}
              className={`camp-block${isAlert ? " camp-alert-pulse" : ""}${isSelected ? " camp-selected" : ""}`}
              style={{
                position: "absolute",
                left: `${leftPct.toFixed(3)}%`,
                top: `${topPct.toFixed(3)}%`,
                width: `${wPct.toFixed(3)}%`,
                height: `${hPct.toFixed(3)}%`,
                border: `1.5px solid ${colors.border}`,
                background: colors.bg,
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "5px 7px 4px",
                overflow: "hidden",
                userSelect: "none",
                boxSizing: "border-box",
              }}
            >
              {/* Top row: name + hectares */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
                <span
                  style={{
                    fontFamily: "var(--font-dm-serif)",
                    color: "#1A1510",
                    fontSize: "clamp(9px, 1.1vw, 13px)",
                    lineHeight: 1.1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {camp.camp_name}
                </span>
                <span
                  style={{
                    fontSize: "clamp(7px, 0.7vw, 9px)",
                    color: "rgba(92,61,46,0.45)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    marginLeft: 2,
                  }}
                >
                  {camp.size_hectares}ha
                </span>
              </div>

              {/* Center: animal count */}
              <div
                style={{
                  fontFamily: "var(--font-dm-serif)",
                  color: colors.text,
                  fontSize: "clamp(14px, 2vw, 24px)",
                  lineHeight: 1,
                  textAlign: "center",
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {animalCount}
              </div>

              {/* Bottom row: water icon + status label */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 2,
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    fontSize: "clamp(7px, 0.7vw, 9px)",
                    color: "rgba(92,61,46,0.5)",
                  }}
                >
                  <WaterIcon source={camp.water_source ?? "borehole"} />
                  <span style={{ fontSize: "clamp(6px, 0.65vw, 8px)" }}>
                    {camp.water_source}
                  </span>
                </span>
                {(liveCondition || filterBy === "density") && (
                  <span
                    style={{
                      fontSize: "clamp(6px, 0.65vw, 8px)",
                      color: colors.border,
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                      textTransform: "uppercase",
                    }}
                  >
                    {filterBy === "grazing" && liveCondition?.grazing_quality}
                    {filterBy === "water"   && liveCondition?.water_status}
                    {filterBy === "density" && densityLabel}
                    {filterBy === "days"    && daysLabel}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Compass rose — top-right */}
        <div
          style={{
            position: "absolute",
            top: "2.5%",
            right: "1.5%",
            opacity: 0.85,
            pointerEvents: "none",
          }}
        >
          <CompassRose />
        </div>

        {/* Scale bar — bottom-left */}
        <div
          style={{
            position: "absolute",
            bottom: "2%",
            left: "2%",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 2,
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <div style={{ width: 1, height: 6, background: "rgba(92,61,46,0.5)" }} />
            <div style={{ width: 48, height: 1.5, background: "rgba(92,61,46,0.5)" }} />
            <div style={{ width: 1, height: 6, background: "rgba(92,61,46,0.5)" }} />
          </div>
          <span
            style={{
              fontSize: 8,
              color: "rgba(92,61,46,0.5)",
              fontFamily: "var(--font-sans)",
              letterSpacing: "0.05em",
            }}
          >
            ≈ 10 km
          </span>
        </div>

        {/* Survey label — bottom-right */}
        <div
          style={{
            position: "absolute",
            bottom: "1.8%",
            right: "1.8%",
            pointerEvents: "none",
            textAlign: "right",
          }}
        >
          <div
            style={{
              fontSize: 8,
              color: "rgba(92,61,46,0.4)",
              fontFamily: "var(--font-sans)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Delta Livestock · Schematic Layout
          </div>
        </div>
      </div>
    </div>
  );
}
