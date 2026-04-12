"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LiveCampStatus } from "@/lib/server/camp-status";
import type { Camp } from "@/lib/types";
import { DEFAULT_CAMP_COLOR } from "@/lib/camp-colors";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FilterMode = "grazing" | "water" | "density" | "days";

interface Props {
  onCampClick: (campId: string) => void;
  onViewDetails?: (campId: string) => void;
  filterBy: FilterMode;
  selectedCampId: string | null;
  liveConditions?: Record<string, LiveCampStatus>;
  camps: Camp[];
  campAnimalCounts: Record<string, number>;
}

// ─── Logical canvas dimensions ────────────────────────────────────────────────

const CANVAS_W = 1100;
const CANVAS_H = 630;
const ZOOM_SCALE = 2.5;

// ─── Camp center positions ─────────────────────────────────────────────────────

export const CAMP_CENTERS: Record<string, { cx: number; cy: number }> = {
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

export const ROAD_PAIRS: [string, string][] = [
  ["I-1", "I-3"], ["I-3", "A"], ["A", "B"],
  ["C", "D"], ["D", "Teerlings"], ["Teerlings", "Sirkel"],
  ["Bulle", "H"], ["H", "Uithoek"], ["Uithoek", "Wildskamp"],
  ["Bloukom", "Ben se Huis"], ["Ben se Huis", "Everlyn"], ["Everlyn", "Praalhoek"],
  ["Praalhoek Verse", "B4"], ["B4", "B1"],
  ["I-1", "C"], ["C", "Bulle"], ["Bulle", "Bloukom"], ["Bloukom", "Praalhoek Verse"],
  ["I-3", "D"], ["D", "H"], ["H", "Ben se Huis"], ["Ben se Huis", "B4"],
  ["A", "Teerlings"], ["Teerlings", "Uithoek"], ["Uithoek", "Everlyn"], ["Everlyn", "B1"],
  ["B", "Sirkel"], ["Sirkel", "Wildskamp"], ["Wildskamp", "Praalhoek"],
];

// ─── Fallback grid layout for camps not in CAMP_CENTERS ──────────────────────
// Produces a deterministic grid position so every tenant's camps render.

function computeFallbackCenter(index: number, total: number): { cx: number; cy: number } {
  const cols = Math.min(4, Math.max(1, total));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    cx: Math.round((col + 0.5) * (CANVAS_W / cols)),
    cy: 80 + row * 140,
  };
}

// ─── Size helper ──────────────────────────────────────────────────────────────

export function campSize(ha: number): { w: number; h: number } {
  const w = Math.round(90 + ((ha - 60) / (245 - 60)) * 80);
  const h = Math.round(w * 0.58);
  return { w, h };
}

// ─── Color helpers ────────────────────────────────────────────────────────────

export const WARM = {
  good:  { border: "#4A7C59", bg: "rgba(74,124,89,0.08)",   text: "#3A6A48", label: "Good"     },
  fair:  { border: "#8B6914", bg: "rgba(139,105,20,0.08)",  text: "#6B4E10", label: "Fair"     },
  poor:  { border: "#A0522D", bg: "rgba(160,82,45,0.10)",   text: "#7A3A18", label: "Poor"     },
  bad:   { border: "#8B3A3A", bg: "rgba(139,58,58,0.12)",   text: "#8B1A1A", label: "Critical" },
  water: { border: "#3B7A8B", bg: "rgba(59,122,139,0.08)",  text: "#2A6070", label: "Full"     },
};

// Pure function — no dummy-data side effects
export function getCampColors(
  filterBy: FilterMode,
  liveCondition: LiveCampStatus | undefined,
  animalCount: number,
  sizeHectares: number,
) {
  if (filterBy === "grazing") {
    const q = liveCondition?.grazing_quality ?? "Fair";
    if (q === "Good") return WARM.good;
    if (q === "Fair") return WARM.fair;
    if (q === "Poor") return WARM.poor;
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
    const d = sizeHectares > 0 ? animalCount / sizeHectares : 0;
    if (d < 0.25) return WARM.good;
    if (d < 0.38) return WARM.fair;
    if (d < 0.50) return WARM.poor;
    return WARM.bad;
  }
  // days
  if (liveCondition?.last_inspected_at) {
    const days = Math.floor((Date.now() - new Date(liveCondition.last_inspected_at).getTime()) / 86400000);
    if (days === 0) return WARM.good;
    if (days === 1) return WARM.fair;
    if (days <= 3)  return WARM.poor;
    return WARM.bad;
  }
  return WARM.bad;
}

// ─── Water source icon ────────────────────────────────────────────────────────

function WaterIcon({ source }: { source: string }) {
  const icons: Record<string, string> = { borehole: "⬤", dam: "≋", river: "〜", trough: "⊓" };
  return <span style={{ fontSize: 9, opacity: 0.7 }}>{icons[source] ?? "·"}</span>;
}

// ─── Compass Rose ─────────────────────────────────────────────────────────────

function CompassRose() {
  const amber = "#5C3D2E";
  const tan = "rgba(92,61,46,0.45)";
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="none" stroke={tan} strokeWidth="0.75" />
      <circle cx="32" cy="32" r="3" fill={amber} />
      {[0, 90, 180, 270].map((deg) => (
        <line key={deg} x1="32" y1="6" x2="32" y2="12"
          stroke={amber} strokeWidth="1.5" transform={`rotate(${deg} 32 32)`} />
      ))}
      <polygon points="32,8 29,22 32,19 35,22" fill={amber} />
      <polygon points="32,56 29,42 32,45 35,42" fill={tan} />
      <line x1="8" y1="32" x2="56" y2="32" stroke={tan} strokeWidth="0.75" />
      <text x="32" y="5"  textAnchor="middle" fill={amber} fontSize="7" fontFamily="var(--font-sans)" fontWeight="600">N</text>
      <text x="32" y="61" textAnchor="middle" fill={tan}   fontSize="6" fontFamily="var(--font-sans)">S</text>
      <text x="61" y="34" textAnchor="middle" fill={tan}   fontSize="6" fontFamily="var(--font-sans)">E</text>
      <text x="3"  y="34" textAnchor="middle" fill={tan}   fontSize="6" fontFamily="var(--font-sans)">W</text>
    </svg>
  );
}

// ─── Topographic SVG underlay ─────────────────────────────────────────────────

function TopoUnderlay() {
  const strokeColor = "rgba(92,61,46,0.09)";
  const roadColor   = "rgba(92,61,46,0.22)";
  const ellipses = [
    { rx: 520, ry: 260, rotate: -8  },
    { rx: 420, ry: 200, rotate: -12 },
    { rx: 320, ry: 150, rotate: -6  },
    { rx: 220, ry: 105, rotate: -10 },
    { rx: 130, ry: 65,  rotate: -8  },
  ];

  return (
    <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      <defs>
        <radialGradient id="schTG1" cx="30%" cy="35%" r="45%">
          <stop offset="0%"   stopColor="rgba(92,61,46,0.07)" />
          <stop offset="100%" stopColor="rgba(92,61,46,0)" />
        </radialGradient>
        <radialGradient id="schTG2" cx="72%" cy="65%" r="40%">
          <stop offset="0%"   stopColor="rgba(70,50,30,0.055)" />
          <stop offset="100%" stopColor="rgba(70,50,30,0)" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width={CANVAS_W} height={CANVAS_H} fill="url(#schTG1)" />
      <rect x="0" y="0" width={CANVAS_W} height={CANVAS_H} fill="url(#schTG2)" />
      <g transform={`translate(${CANVAS_W / 2} ${CANVAS_H / 2})`}>
        {ellipses.map((e, i) => (
          <ellipse key={i} rx={e.rx} ry={e.ry} fill="none" stroke={strokeColor}
            strokeWidth="1" transform={`rotate(${e.rotate})`} />
        ))}
      </g>
      {ROAD_PAIRS.map(([a, b], i) => {
        const ca = CAMP_CENTERS[a];
        const cb = CAMP_CENTERS[b];
        if (!ca || !cb) return null;
        return (
          <line key={i} x1={ca.cx} y1={ca.cy} x2={cb.cx} y2={cb.cy}
            stroke={roadColor} strokeWidth="1.2" strokeDasharray="5,8" strokeLinecap="round" />
        );
      })}
      {([
        [12, 12, 1, 1] as const, [CANVAS_W - 12, 12, -1, 1] as const,
        [12, CANVAS_H - 12, 1, -1] as const, [CANVAS_W - 12, CANVAS_H - 12, -1, -1] as const,
      ]).map(([x, y, dx, dy], i) => (
        <g key={i} stroke="rgba(92,61,46,0.4)" strokeWidth="1" fill="none">
          <polyline points={`${x + dx * 18},${y} ${x},${y} ${x},${y + dy * 18}`} />
        </g>
      ))}
      <rect x="6" y="6" width={CANVAS_W - 12} height={CANVAS_H - 12}
        fill="none" stroke="rgba(92,61,46,0.15)" strokeWidth="1" />
    </svg>
  );
}

// ─── Expanded camp card ───────────────────────────────────────────────────────

function ExpandedCampCard({
  camp,
  colors,
  animalCount,
  filterBy,
  liveCondition,
  onViewDetails,
}: {
  camp: Camp;
  colors: ReturnType<typeof getCampColors>;
  animalCount: number;
  filterBy: FilterMode;
  liveCondition?: LiveCampStatus;
  onViewDetails: (id: string) => void;
}) {
  const grazingQ  = liveCondition?.grazing_quality ?? "—";
  const waterS    = liveCondition?.water_status    ?? "—";
  const daysAgo   = liveCondition?.last_inspected_at
    ? Math.floor((Date.now() - new Date(liveCondition.last_inspected_at).getTime()) / 86400000)
    : null;
  const inspector = liveCondition?.last_inspected_by ?? null;
  const lastLabel = daysAgo === null ? "—" : daysAgo === 0 ? "Today" : `${daysAgo}d ago${inspector ? ` · ${inspector}` : ""}`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.12, duration: 0.18 }}
      style={{ display: "flex", flexDirection: "column", height: "100%", padding: "5px 7px 5px", gap: 3 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3 }}>
        <span style={{ fontFamily: "var(--font-dm-serif)", color: "#1A1510", fontSize: 11, fontWeight: 600, lineHeight: 1.1, flex: 1 }}>
          {camp.camp_name}
        </span>
        <span style={{
          fontSize: 8, color: colors.border, fontWeight: 700,
          letterSpacing: "0.05em", textTransform: "uppercase",
          padding: "1px 5px", borderRadius: 4, border: `1px solid ${colors.border}`,
        }}>
          {colors.label}
        </span>
      </div>

      {/* Count */}
      <div style={{ fontFamily: "var(--font-dm-serif)", color: colors.text, fontSize: 20, lineHeight: 1, textAlign: "center" }}>
        {animalCount}
        <span style={{ fontSize: 8, color: "rgba(26,21,16,0.4)", marginLeft: 3, fontFamily: "var(--font-sans)" }}>
          head · {camp.size_hectares}ha
        </span>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {[
          { label: "Grazing", val: grazingQ, color: colors.text },
          { label: "Water",   val: waterS,   color: waterS === "Full" ? "#2A6070" : "#8B3A3A" },
          { label: "Last",    val: lastLabel, color: "inherit" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 8, fontFamily: "var(--font-sans)", color: "rgba(26,21,16,0.55)" }}>
            <span>{label}</span>
            <span style={{ fontWeight: 600, color }}>{val}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={(e) => { e.stopPropagation(); onViewDetails(camp.camp_id); }}
        style={{
          marginTop: "auto",
          background: "rgba(26,21,16,0.05)",
          border: `1px solid ${colors.border}`,
          color: colors.text,
          borderRadius: 5,
          padding: "3px 6px",
          fontSize: 8,
          fontFamily: "var(--font-sans)",
          fontWeight: 600,
          letterSpacing: "0.03em",
          cursor: "pointer",
          textAlign: "center",
        }}
      >
        View Full Details →
      </button>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SchematicMap({
  onCampClick,
  onViewDetails,
  filterBy,
  selectedCampId,
  liveConditions = {},
  camps,
  campAnimalCounts,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Internal zoom state — independent from selectedCampId
  const [zoomedCampId, setZoomedCampId] = useState<string | null>(null);
  const [zoomTransform, setZoomTransform] = useState({ scale: 1, x: 0, y: 0 });

  // Sync zoom when selected camp is cleared from outside (e.g. panel closed)
  useEffect(() => {
    if (!selectedCampId) setZoomedCampId(null);
  }, [selectedCampId]);

  useEffect(() => {
    if (!zoomedCampId) {
      setZoomTransform({ scale: 1, x: 0, y: 0 });
      return;
    }
    const center = CAMP_CENTERS[zoomedCampId];
    if (!center || !containerRef.current) return;
    const { clientWidth: cW, clientHeight: cH } = containerRef.current;
    setZoomTransform({
      scale: ZOOM_SCALE,
      x: cW / 2 - center.cx * ZOOM_SCALE,
      y: cH / 2 - center.cy * ZOOM_SCALE,
    });
  }, [zoomedCampId]);

  function handleZoomOut() {
    setZoomedCampId(null);
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleZoomOut(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleContainerClick = useCallback(() => {
    if (zoomedCampId) handleZoomOut();
  }, [zoomedCampId]);

  // Pre-compute fallback grid positions for camps that have no CAMP_CENTERS entry.
  // This ensures all tenants see their camps rendered instead of a blank map.
  const unknownCamps = camps.filter((c) => !CAMP_CENTERS[c.camp_id]);
  const fallbackIndexMap = new Map(unknownCamps.map((c, i) => [c.camp_id, i]));

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative", width: "100%", height: "100%",
        background: "#FFFFFF", overflow: "hidden",
        cursor: zoomedCampId ? "zoom-out" : "default",
      }}
      onClick={handleContainerClick}
    >
      {/* Zoomable canvas */}
      <motion.div
        style={{ position: "absolute", width: CANVAS_W, height: CANVAS_H, transformOrigin: "0 0" }}
        animate={{ scale: zoomTransform.scale, x: zoomTransform.x, y: zoomTransform.y }}
        transition={{ type: "spring", stiffness: 90, damping: 22 }}
      >
        <TopoUnderlay />

        {camps.map((camp) => {
          const center        = CAMP_CENTERS[camp.camp_id]
            ?? computeFallbackCenter(fallbackIndexMap.get(camp.camp_id) ?? 0, unknownCamps.length);

          const { w, h }      = campSize(camp.size_hectares ?? 120);
          const liveCondition = liveConditions[camp.camp_id];
          const animalCount   = campAnimalCounts[camp.camp_id] ?? 0;
          const colors        = getCampColors(filterBy, liveCondition, animalCount, camp.size_hectares ?? 120);
          const identityColor = camp.color ?? DEFAULT_CAMP_COLOR;
          const isAlert       = liveCondition
            ? liveCondition.grazing_quality === "Overgrazed" || liveCondition.water_status === "Empty" || liveCondition.water_status === "Broken" || liveCondition.fence_status === "Damaged"
            : false;
          const isZoomed      = zoomedCampId === camp.camp_id;
          const isDimmed      = zoomedCampId !== null && !isZoomed;

          const density       = (camp.size_hectares ?? 120) > 0
            ? (animalCount / (camp.size_hectares ?? 120)).toFixed(2)
            : "—";
          const daysAgo       = liveCondition?.last_inspected_at
            ? Math.floor((Date.now() - new Date(liveCondition.last_inspected_at).getTime()) / 86400000)
            : null;

          const leftPct = ((center.cx - w / 2) / CANVAS_W) * 100;
          const topPct  = ((center.cy - h / 2) / CANVAS_H) * 100;
          const wPct    = (w / CANVAS_W) * 100;
          const hPct    = (h / CANVAS_H) * 100;

          return (
            <motion.div
              key={camp.camp_id}
              onClick={(e) => { e.stopPropagation(); setZoomedCampId(camp.camp_id); onCampClick(camp.camp_id); }}
              className={isAlert && !isZoomed ? "camp-alert-pulse" : ""}
              animate={{ opacity: isDimmed ? 0.18 : 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 24 }}
              style={{
                position: "absolute",
                left: `${leftPct.toFixed(3)}%`,
                top: `${topPct.toFixed(3)}%`,
                width: `${wPct.toFixed(3)}%`,
                height: `${hPct.toFixed(3)}%`,
                borderTop: `${isZoomed ? "2px" : "1.5px"} solid ${colors.border}`,
                borderRight: `${isZoomed ? "2px" : "1.5px"} solid ${colors.border}`,
                borderBottom: `${isZoomed ? "2px" : "1.5px"} solid ${colors.border}`,
                borderLeft: `4px solid ${identityColor}`,
                background: isZoomed ? "rgba(255,255,255,0.98)" : colors.bg,
                borderRadius: 8,
                cursor: "pointer",
                overflow: "hidden",
                userSelect: "none",
                boxSizing: "border-box",
                boxShadow: isZoomed ? `0 4px 24px rgba(0,0,0,0.14), 0 0 0 2px ${identityColor}40` : "none",
              }}
            >
              {isZoomed ? (
                <ExpandedCampCard
                  camp={camp}
                  colors={colors}
                  animalCount={animalCount}
                  filterBy={filterBy}
                  liveCondition={liveCondition}
                  onViewDetails={onViewDetails ?? onCampClick}
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", padding: "5px 7px 4px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
                    <span style={{
                      fontFamily: "var(--font-dm-serif)", color: "#1A1510",
                      fontSize: "clamp(9px, 1.1vw, 13px)", lineHeight: 1.1,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                    }}>
                      {camp.camp_name}
                    </span>
                    <span style={{ fontSize: "clamp(7px, 0.7vw, 9px)", color: "rgba(92,61,46,0.45)", whiteSpace: "nowrap", flexShrink: 0, marginLeft: 2 }}>
                      {camp.size_hectares}ha
                    </span>
                  </div>
                  <div style={{
                    fontFamily: "var(--font-dm-serif)", color: colors.text,
                    fontSize: "clamp(14px, 2vw, 24px)", lineHeight: 1,
                    textAlign: "center", flex: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {animalCount}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: "clamp(7px, 0.7vw, 9px)", color: "rgba(92,61,46,0.5)" }}>
                      <WaterIcon source={camp.water_source ?? "borehole"} />
                      <span style={{ fontSize: "clamp(6px, 0.65vw, 8px)" }}>{camp.water_source}</span>
                    </span>
                    <span style={{ fontSize: "clamp(6px, 0.65vw, 8px)", color: colors.border, fontWeight: 600, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                      {filterBy === "grazing" && (liveCondition?.grazing_quality ?? "—")}
                      {filterBy === "water"   && (liveCondition?.water_status ?? "—")}
                      {filterBy === "density" && `${density}/ha`}
                      {filterBy === "days"    && (daysAgo !== null ? `${daysAgo}d` : "—")}
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}

        {/* Compass */}
        <div style={{ position: "absolute", top: "2.5%", right: "1.5%", opacity: 0.85, pointerEvents: "none" }}>
          <CompassRose />
        </div>

        {/* Scale bar */}
        <div style={{ position: "absolute", bottom: "2%", left: "2%", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 1, height: 6, background: "rgba(92,61,46,0.5)" }} />
            <div style={{ width: 48, height: 1.5, background: "rgba(92,61,46,0.5)" }} />
            <div style={{ width: 1, height: 6, background: "rgba(92,61,46,0.5)" }} />
          </div>
          <span style={{ fontSize: 8, color: "rgba(92,61,46,0.5)", fontFamily: "var(--font-sans)", letterSpacing: "0.05em" }}>≈ 10 km</span>
        </div>

        {/* Survey label */}
        <div style={{ position: "absolute", bottom: "1.8%", right: "1.8%", pointerEvents: "none", textAlign: "right" }}>
          <div style={{ fontSize: 8, color: "rgba(92,61,46,0.4)", fontFamily: "var(--font-sans)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            FarmTrack · Schematic Layout
          </div>
        </div>
      </motion.div>

      {/* Zoom-out overlay button */}
      <AnimatePresence>
        {zoomedCampId && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            onClick={(e) => { e.stopPropagation(); handleZoomOut(); }}
            style={{
              position: "absolute", top: 12, left: 12, zIndex: 10,
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 12px", borderRadius: 8,
              background: "rgba(26,21,16,0.88)",
              border: "1px solid rgba(139,105,20,0.35)",
              color: "#F5EBD4", fontSize: 11,
              fontFamily: "var(--font-sans)", fontWeight: 500,
              letterSpacing: "0.03em", cursor: "pointer",
              backdropFilter: "blur(6px)",
            }}
          >
            ← Zoom Out
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
