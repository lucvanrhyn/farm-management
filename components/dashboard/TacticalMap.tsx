"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LiveCampStatus } from "@/lib/server/camp-status";
import type { Camp } from "@/lib/types";
import {
  CAMP_CENTERS,
  ROAD_PAIRS,
  campSize,
  getCampColors,
  type FilterMode,
} from "./SchematicMap";

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_W = 1100;
const CANVAS_H = 630;
const ZOOM_SCALE = 2.5;

// Neon color variants for tactical view
const NEON_MAP: Record<string, string> = {
  Good:     "#22c55e",
  Fair:     "#eab308",
  Poor:     "#f97316",
  Critical: "#ef4444",
  Full:     "#38bdf8",
};
function neonFor(label: string): string {
  return NEON_MAP[label] ?? "#ef4444";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  onCampClick: (campId: string) => void;
  onViewDetails?: (campId: string) => void;
  filterBy: FilterMode;
  selectedCampId: string | null;
  liveConditions?: Record<string, LiveCampStatus>;
  camps: Camp[];
  campAnimalCounts: Record<string, number>;
}

// ─── Grid Overlay ─────────────────────────────────────────────────────────────

function GridOverlay() {
  const grid   = "rgba(74,222,128,0.045)";
  const border = "rgba(74,222,128,0.12)";
  const corner = "rgba(74,222,128,0.35)";

  const vLines: React.ReactNode[] = [];
  const hLines: React.ReactNode[] = [];
  for (let x = 0; x <= CANVAS_W; x += 80) {
    vLines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={CANVAS_H} stroke={grid} strokeWidth="1" />);
  }
  for (let y = 0; y <= CANVAS_H; y += 80) {
    hLines.push(<line key={`h${y}`} x1={0} y1={y} x2={CANVAS_W} y2={y} stroke={grid} strokeWidth="1" />);
  }

  return (
    <svg
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    >
      {vLines}
      {hLines}
      {/* Border frame */}
      <rect x="4" y="4" width={CANVAS_W - 8} height={CANVAS_H - 8}
        fill="none" stroke={border} strokeWidth="1" />
      {/* Corner brackets */}
      {([
        [12, 12, 1, 1] as const,
        [CANVAS_W - 12, 12, -1, 1] as const,
        [12, CANVAS_H - 12, 1, -1] as const,
        [CANVAS_W - 12, CANVAS_H - 12, -1, -1] as const,
      ]).map(([x, y, dx, dy], i) => (
        <g key={i} stroke={corner} strokeWidth="1.5" fill="none">
          <polyline points={`${x + dx * 22},${y} ${x},${y} ${x},${y + dy * 22}`} />
        </g>
      ))}
    </svg>
  );
}

// ─── Terrain Blobs ────────────────────────────────────────────────────────────

function TerrainBlobs() {
  return (
    <svg
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    >
      <defs>
        <radialGradient id="tacTG1" cx="25%" cy="30%" r="40%">
          <stop offset="0%"   stopColor="rgba(74,222,128,0.028)" />
          <stop offset="100%" stopColor="rgba(74,222,128,0)"     />
        </radialGradient>
        <radialGradient id="tacTG2" cx="75%" cy="68%" r="38%">
          <stop offset="0%"   stopColor="rgba(74,222,128,0.022)" />
          <stop offset="100%" stopColor="rgba(74,222,128,0)"     />
        </radialGradient>
        <radialGradient id="tacTG3" cx="52%" cy="45%" r="30%">
          <stop offset="0%"   stopColor="rgba(10,18,28,0.55)" />
          <stop offset="100%" stopColor="rgba(10,18,28,0)"    />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="url(#tacTG1)" />
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="url(#tacTG2)" />
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="url(#tacTG3)" />
    </svg>
  );
}

// ─── Tactical Compass ─────────────────────────────────────────────────────────

function TacticalCompass() {
  const green  = "#4ade80";
  const dim    = "rgba(74,222,128,0.28)";
  const dimFil = "rgba(74,222,128,0.07)";

  return (
    <svg width="72" height="72" viewBox="0 0 72 72">
      {[30, 23, 16, 10].map((r, i) => (
        <circle key={r} cx="36" cy="36" r={r}
          fill={i === 0 ? dimFil : "none"}
          stroke={dim} strokeWidth={i === 0 ? "0.8" : "0.5"} />
      ))}
      <line x1="8"  y1="36" x2="64" y2="36" stroke={dim} strokeWidth="0.5" strokeDasharray="2,5" />
      <line x1="36" y1="8"  x2="36" y2="64" stroke={dim} strokeWidth="0.5" strokeDasharray="2,5" />
      {[0, 90, 180, 270].map((deg) => (
        <line key={deg} x1="36" y1="6" x2="36" y2="13"
          stroke={deg === 0 ? green : dim} strokeWidth={deg === 0 ? "2" : "1"}
          transform={`rotate(${deg} 36 36)`} />
      ))}
      <polygon points="36,8 33.5,19 36,16.5 38.5,19" fill={green} />
      <polygon points="36,64 33.5,53 36,55.5 38.5,53" fill={dim}   />
      <circle cx="36" cy="36" r="2.5" fill={green} />
      <text x="36" y="5.5" textAnchor="middle" fill={green} fontSize="7" fontFamily="var(--font-sans)" fontWeight="700" letterSpacing="0.06em">N</text>
      <text x="36" y="69"  textAnchor="middle" fill={dim}   fontSize="6" fontFamily="var(--font-sans)">S</text>
      <text x="69" y="37.5" textAnchor="middle" fill={dim}  fontSize="6" fontFamily="var(--font-sans)">E</text>
      <text x="3"  y="37.5" textAnchor="middle" fill={dim}  fontSize="6" fontFamily="var(--font-sans)">W</text>
    </svg>
  );
}

// ─── HUD Status Bar ───────────────────────────────────────────────────────────

function HUDStatusBar() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = now
    ? now.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : "--:--:--";

  const fields = [
    `CLOCK: ${timeStr}`,
    "ATMOSPHERIC: 28.4°C  HUMID 42%",
    "SAT-LINK: ██ LOCKED  98ms",
    "FARMTRACK OS v4.2.0",
  ];

  return (
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0,
      height: 30,
      background: "rgba(7,11,15,0.94)",
      borderTop: "1px solid rgba(74,222,128,0.13)",
      display: "flex", alignItems: "center",
      padding: "0 14px", zIndex: 15,
      backdropFilter: "blur(4px)",
    }}>
      {fields.map((f, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center" }}>
          {i > 0 && (
            <span style={{ color: "rgba(74,222,128,0.18)", margin: "0 10px", fontSize: 8 }}>·</span>
          )}
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: 9,
            letterSpacing: "0.07em", color: "rgba(74,222,128,0.42)", whiteSpace: "nowrap",
          }}>
            {f}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

function ActivityFeed({
  camps,
  liveConditions,
}: {
  camps: Camp[];
  liveConditions: Record<string, LiveCampStatus>;
}) {
  const events = camps
    .map((camp) => {
      const live = liveConditions[camp.camp_id];
      if (!live) return null;
      const isAlert =
        live.water_status === "Empty" ||
        live.water_status === "Broken" ||
        live.grazing_quality === "Overgrazed" ||
        live.fence_status === "Damaged";
      const daysAgo = live.last_inspected_at
        ? Math.floor((Date.now() - new Date(live.last_inspected_at).getTime()) / 86400000)
        : null;
      return { camp, live, isAlert, daysAgo };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => {
      if (a.isAlert !== b.isAlert) return a.isAlert ? -1 : 1;
      return (a.daysAgo ?? 99) - (b.daysAgo ?? 99);
    })
    .slice(0, 6);

  if (events.length === 0) return null;

  return (
    <div style={{
      position: "absolute", top: 12, right: 12,
      width: 220,
      maxHeight: "calc(100% - 60px)",
      background: "rgba(7,11,15,0.9)",
      border: "1px solid rgba(74,222,128,0.18)",
      borderRadius: 8,
      overflow: "hidden",
      zIndex: 20,
      backdropFilter: "blur(8px)",
    }}>
      {/* Header */}
      <div style={{
        padding: "5px 10px",
        borderBottom: "1px solid rgba(74,222,128,0.1)",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: "#4ade80", flexShrink: 0,
          animation: "ping 2s cubic-bezier(0,0,0.2,1) infinite",
        }} />
        <span style={{
          fontSize: 8, color: "rgba(74,222,128,0.65)",
          fontFamily: "var(--font-sans)", letterSpacing: "0.1em",
          textTransform: "uppercase", fontWeight: 600,
        }}>
          Live Conditions
        </span>
      </div>

      {/* Event rows */}
      <div style={{ overflowY: "auto", maxHeight: 290 }}>
        {events.map(({ camp, live, isAlert, daysAgo }) => {
          const color = isAlert ? "#ef4444" : "#4ade80";
          let desc = `Grazing: ${live.grazing_quality}`;
          if (live.water_status === "Empty" || live.water_status === "Broken")
            desc = `Water: ${live.water_status}`;
          else if (live.grazing_quality === "Overgrazed")
            desc = "Overgrazing alert";
          else if (live.fence_status === "Damaged")
            desc = "Fence damaged";
          const timeLabel =
            daysAgo === null ? "—" : daysAgo === 0 ? "Today" : `${daysAgo}d ago`;

          return (
            <div key={camp.camp_id} style={{
              padding: "5px 10px",
              borderBottom: "1px solid rgba(74,222,128,0.06)",
              display: "flex", flexDirection: "column", gap: 2,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{
                  fontSize: 9, fontFamily: "var(--font-sans)", fontWeight: 600,
                  color, letterSpacing: "0.03em",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120,
                }}>
                  {camp.camp_name}
                </span>
                <span style={{ fontSize: 8, color: "rgba(74,222,128,0.28)", fontFamily: "var(--font-sans)" }}>
                  {timeLabel}
                </span>
              </div>
              <span style={{ fontSize: 8, color: "rgba(74,222,128,0.42)", fontFamily: "var(--font-sans)" }}>
                {desc}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Expanded Camp Card (tactical style) ─────────────────────────────────────

function TacticalExpandedCard({
  camp,
  neonColor,
  animalCount,
  filterBy,
  liveCondition,
  onViewDetails,
}: {
  camp: Camp;
  neonColor: string;
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
  const lastLabel = daysAgo === null ? "—" : daysAgo === 0 ? "Today" : `${daysAgo}d ago`;
  const density   = (camp.size_hectares ?? 120) > 0
    ? (animalCount / (camp.size_hectares ?? 120)).toFixed(2)
    : "—";

  const rows = [
    { label: "GRAZING", val: grazingQ },
    { label: "WATER",   val: waterS   },
    { label: "INSPECT", val: lastLabel },
    { label: "DENSITY", val: `${density}/ha` },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1, duration: 0.18 }}
      style={{
        display: "flex", flexDirection: "column",
        height: "100%", padding: "6px 8px",
        gap: 4,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Name + status badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700,
          color: neonColor, letterSpacing: "0.06em", textTransform: "uppercase",
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {camp.camp_name}
        </span>
        <span style={{
          fontSize: 8, color: neonColor, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", padding: "1px 5px", borderRadius: 3,
          border: `1px solid ${neonColor}45`,
          background: `${neonColor}12`,
          flexShrink: 0,
        }}>
          {filterBy === "water" ? waterS : grazingQ}
        </span>
      </div>

      {/* Head count */}
      <div style={{
        fontFamily: "var(--font-sans)", color: neonColor,
        fontSize: 22, fontWeight: 700, lineHeight: 1,
        textAlign: "center", fontVariantNumeric: "tabular-nums",
      }}>
        {animalCount}
        <span style={{ fontSize: 9, color: "rgba(74,222,128,0.3)", marginLeft: 4 }}>
          head · {camp.size_hectares}ha
        </span>
      </div>

      {/* Stat rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {rows.map(({ label, val }) => (
          <div key={label} style={{
            display: "flex", justifyContent: "space-between",
            fontSize: 8, fontFamily: "var(--font-sans)", letterSpacing: "0.04em",
          }}>
            <span style={{ color: "rgba(74,222,128,0.28)", textTransform: "uppercase" }}>{label}</span>
            <span style={{ color: "rgba(74,222,128,0.72)", fontWeight: 600 }}>{val}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={(e) => { e.stopPropagation(); onViewDetails(camp.camp_id); }}
        style={{
          marginTop: "auto",
          background: `${neonColor}10`,
          border: `1px solid ${neonColor}40`,
          color: neonColor,
          borderRadius: 4,
          padding: "4px 8px",
          fontSize: 9, fontFamily: "var(--font-sans)", fontWeight: 700,
          letterSpacing: "0.06em", cursor: "pointer",
          textAlign: "center", textTransform: "uppercase",
        }}
      >
        View Full Details →
      </button>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TacticalMap({
  onCampClick,
  onViewDetails,
  filterBy,
  selectedCampId,
  liveConditions = {},
  camps,
  campAnimalCounts,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoomedCampId, setZoomedCampId]     = useState<string | null>(null);
  const [zoomTransform, setZoomTransform]   = useState({ scale: 1, x: 0, y: 0 });

  // Sync: reset zoom when panel closes externally
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

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative", width: "100%", height: "100%",
        background: "#070B0F",
        overflow: "hidden",
        cursor: zoomedCampId ? "zoom-out" : "default",
        // Scanlines
        backgroundImage:
          "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(74,222,128,0.012) 3px, rgba(74,222,128,0.012) 4px)",
      }}
      onClick={handleContainerClick}
    >
      <TerrainBlobs />

      {/* Zoomable canvas */}
      <motion.div
        style={{
          position: "absolute", width: CANVAS_W, height: CANVAS_H,
          transformOrigin: "0 0",
        }}
        animate={{ scale: zoomTransform.scale, x: zoomTransform.x, y: zoomTransform.y }}
        transition={{ type: "spring", stiffness: 90, damping: 22 }}
      >
        <GridOverlay />

        {/* Road lines */}
        <svg
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            pointerEvents: "none",
          }}
        >
          {ROAD_PAIRS.map(([a, b], i) => {
            const ca = CAMP_CENTERS[a];
            const cb = CAMP_CENTERS[b];
            if (!ca || !cb) return null;
            return (
              <line
                key={i}
                x1={ca.cx} y1={ca.cy} x2={cb.cx} y2={cb.cy}
                stroke="rgba(74,222,128,0.22)"
                strokeWidth="1.2"
                strokeDasharray="6,8"
                strokeLinecap="round"
              />
            );
          })}
        </svg>

        {/* Camp nodes */}
        {camps.map((camp) => {
          const center = CAMP_CENTERS[camp.camp_id];
          if (!center) return null;

          const { w, h }      = campSize(camp.size_hectares ?? 120);
          const liveCondition = liveConditions[camp.camp_id];
          const animalCount   = campAnimalCounts[camp.camp_id] ?? 0;
          const colors        = getCampColors(filterBy, liveCondition, animalCount, camp.size_hectares ?? 120);
          const neonColor     = neonFor(colors.label);
          const isAlert       = liveCondition
            ? liveCondition.water_status === "Empty" ||
              liveCondition.water_status === "Broken" ||
              liveCondition.grazing_quality === "Overgrazed" ||
              liveCondition.fence_status === "Damaged"
            : false;
          const isZoomed = zoomedCampId === camp.camp_id;
          const isDimmed = zoomedCampId !== null && !isZoomed;

          const density        = (camp.size_hectares ?? 120) > 0
            ? animalCount / (camp.size_hectares ?? 120)
            : 0;
          const densityBarPct  = Math.min(100, (density / 0.6) * 100);
          const daysAgo        = liveCondition?.last_inspected_at
            ? Math.floor((Date.now() - new Date(liveCondition.last_inspected_at).getTime()) / 86400000)
            : null;

          const leftPct = ((center.cx - w / 2) / CANVAS_W) * 100;
          const topPct  = ((center.cy - h / 2) / CANVAS_H) * 100;
          const wPct    = (w / CANVAS_W) * 100;
          const hPct    = (h / CANVAS_H) * 100;

          return (
            <motion.div
              key={camp.camp_id}
              onClick={(e) => {
                e.stopPropagation();
                setZoomedCampId(camp.camp_id);
                onCampClick(camp.camp_id);
              }}
              className={isAlert && !isZoomed ? "camp-alert-pulse" : ""}
              animate={{ opacity: isDimmed ? 0.18 : 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 24 }}
              style={{
                position: "absolute",
                left: `${leftPct.toFixed(3)}%`,
                top: `${topPct.toFixed(3)}%`,
                width: `${wPct.toFixed(3)}%`,
                height: `${hPct.toFixed(3)}%`,
                background: isZoomed ? "rgba(7,11,15,0.97)" : "rgba(10,18,28,0.88)",
                borderRadius: 6,
                cursor: "pointer",
                overflow: "hidden",
                userSelect: "none",
                boxSizing: "border-box",
                // Right/top/bottom border: subtle green; left border: neon status color
                borderTop:    `1px solid ${isZoomed ? `${neonColor}55` : "rgba(74,222,128,0.1)"}`,
                borderRight:  `1px solid ${isZoomed ? `${neonColor}55` : "rgba(74,222,128,0.1)"}`,
                borderBottom: `1px solid ${isZoomed ? `${neonColor}55` : "rgba(74,222,128,0.1)"}`,
                borderLeft:   `3px solid ${neonColor}`,
                boxShadow: isZoomed
                  ? `0 0 20px ${neonColor}22, 0 4px 24px rgba(0,0,0,0.5)`
                  : `0 0 6px ${neonColor}10`,
              }}
            >
              {isZoomed ? (
                <TacticalExpandedCard
                  camp={camp}
                  neonColor={neonColor}
                  animalCount={animalCount}
                  filterBy={filterBy}
                  liveCondition={liveCondition}
                  onViewDetails={onViewDetails ?? onCampClick}
                />
              ) : (
                <div style={{
                  display: "flex", flexDirection: "column",
                  justifyContent: "space-between", height: "100%",
                  padding: "4px 6px 3px 5px",
                }}>
                  {/* Name + ha */}
                  <div style={{
                    display: "flex", alignItems: "flex-start",
                    justifyContent: "space-between", gap: 2,
                  }}>
                    <span style={{
                      fontFamily: "var(--font-sans)",
                      color: neonColor,
                      fontSize: "clamp(7px, 0.8vw, 10px)",
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      lineHeight: 1.1,
                      overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap", flex: 1,
                    }}>
                      {camp.camp_name}
                    </span>
                    <span style={{
                      fontSize: "clamp(6px, 0.6vw, 8px)",
                      color: "rgba(74,222,128,0.28)",
                      whiteSpace: "nowrap", flexShrink: 0, marginLeft: 2,
                    }}>
                      {camp.size_hectares}ha
                    </span>
                  </div>

                  {/* Head count */}
                  <div style={{
                    fontFamily: "var(--font-sans)",
                    color: "rgba(220,255,235,0.88)",
                    fontSize: "clamp(12px, 1.8vw, 22px)",
                    fontWeight: 700, lineHeight: 1,
                    textAlign: "center", flex: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {animalCount}
                  </div>

                  {/* Density bar + label */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{
                      width: "100%", height: 2,
                      background: "rgba(74,222,128,0.1)",
                      borderRadius: 1, overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${densityBarPct}%`, height: "100%",
                        background: neonColor, borderRadius: 1,
                      }} />
                    </div>
                    <span style={{
                      fontSize: "clamp(6px, 0.6vw, 7px)",
                      color: "rgba(74,222,128,0.32)",
                      fontFamily: "var(--font-sans)",
                    }}>
                      {filterBy === "days" && (daysAgo !== null ? `${daysAgo}d` : "—")}
                      {filterBy === "density" && (density > 0 ? `${density.toFixed(2)}/ha` : "—")}
                      {filterBy === "water" && (liveCondition?.water_status ?? "—")}
                      {filterBy === "grazing" && (liveCondition?.grazing_quality ?? "—")}
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}

        {/* Compass — top-right corner of canvas */}
        <div style={{
          position: "absolute", top: "1.5%", right: "1.5%",
          opacity: 0.88, pointerEvents: "none",
        }}>
          <TacticalCompass />
        </div>

        {/* Label */}
        <div style={{
          position: "absolute", bottom: "6.5%", left: "1.5%",
          pointerEvents: "none",
        }}>
          <span style={{
            fontSize: 8, color: "rgba(74,222,128,0.18)",
            fontFamily: "var(--font-sans)", letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}>
            FARMTRACK · TACTICAL VIEW
          </span>
        </div>
      </motion.div>

      {/* Activity feed — outside canvas, so it doesn't zoom */}
      <ActivityFeed camps={camps} liveConditions={liveConditions} />

      {/* HUD status bar — fixed to bottom */}
      <HUDStatusBar />

      {/* Zoom-out overlay button */}
      <AnimatePresence>
        {zoomedCampId && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1,   y:  0 }}
            exit={{ opacity: 0,   scale: 0.9, y: -4 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            onClick={(e) => { e.stopPropagation(); handleZoomOut(); }}
            style={{
              position: "absolute", top: 12, left: 12, zIndex: 30,
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 12px", borderRadius: 6,
              background: "rgba(7,11,15,0.92)",
              border: "1px solid rgba(74,222,128,0.4)",
              color: "#4ade80",
              fontSize: 11, fontFamily: "var(--font-sans)", fontWeight: 600,
              letterSpacing: "0.06em", textTransform: "uppercase",
              cursor: "pointer",
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
