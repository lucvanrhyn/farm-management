"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LiveCampStatus } from "@/lib/server/camp-status";
import dynamic from "next/dynamic";
import { SignOutButton } from "@/components/logger/SignOutButton";
import CampDetailPanel from "./CampDetailPanel";
import AnimalProfile from "./AnimalProfile";
import SchematicMap, { type FilterMode } from "./SchematicMap";
import TacticalMap from "./TacticalMap";
import type { Camp } from "@/lib/types";

// Leaflet must only render client-side
const FarmMap = dynamic(() => import("@/components/map/FarmMap"), {
  ssr: false,
  loading: () => (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: "#1A1510" }}
    >
      <div className="text-center">
        <div
          className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
          style={{ borderColor: "#8B6914", borderTopColor: "transparent" }}
        />
        <p className="text-sm" style={{ color: "#8B6914" }}>Loading satellite map...</p>
      </div>
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewMode = "tactical" | "schematic" | "satellite";

// ─── Date helper ──────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function getTodayShort(): string {
  const now = new Date();
  return `${now.getDate()} ${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
}

// ─── Filter options ───────────────────────────────────────────────────────────

const FILTER_OPTIONS: { value: FilterMode; label: string }[] = [
  { value: "grazing",  label: "Grazing Quality" },
  { value: "water",    label: "Water Status"    },
  { value: "density",  label: "Stocking Density" },
  { value: "days",     label: "Days Since Inspection" },
];

// ─── Stat chip ────────────────────────────────────────────────────────────────

const chipVariants = {
  hidden: { opacity: 0, y: 6, scale: 0.92 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 200, damping: 22 },
  },
};

function StatChip({
  label,
  value,
  accent,
  pulse,
  dark,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  pulse?: boolean;
  dark?: boolean;
}) {
  if (dark) {
    return (
      <motion.div
        variants={chipVariants}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "4px 12px",
          borderRadius: 8,
          background: accent ? "rgba(239,68,68,0.08)" : "rgba(74,222,128,0.06)",
          border: `1px solid ${accent ? "rgba(239,68,68,0.25)" : "rgba(74,222,128,0.15)"}`,
          gap: 1,
        }}
      >
        {pulse && (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#ef4444",
              animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
            }}
          />
        )}
        <span
          style={{
            fontFamily: "var(--font-dm-serif)",
            fontSize: 18,
            lineHeight: 1,
            color: accent ? "#ef4444" : "#4ade80",
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontSize: 9,
            color: "rgba(74,222,128,0.5)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontFamily: "var(--font-sans)",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={chipVariants}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4px 12px",
        borderRadius: 8,
        background: accent ? "rgba(220,50,50,0.06)" : "rgba(0,0,0,0.04)",
        border: `1px solid ${accent ? "rgba(200,50,50,0.2)" : "rgba(0,0,0,0.08)"}`,
        gap: 1,
      }}
    >
      {pulse && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#B03030",
            animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
          }}
        />
      )}
      <span
        style={{
          fontFamily: "var(--font-dm-serif)",
          fontSize: 18,
          lineHeight: 1,
          color: accent ? "#B03030" : "#1A1510",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 9,
          color: "rgba(26,21,16,0.45)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontFamily: "var(--font-sans)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </motion.div>
  );
}

// ─── Morning briefing helper ──────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ─── View toggle ──────────────────────────────────────────────────────────────

function ViewToggle({
  value,
  onChange,
  dark,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  dark?: boolean;
}) {
  const views: { id: ViewMode; label: string }[] = [
    { id: "tactical",  label: "Tactical"  },
    { id: "schematic", label: "Schematic" },
    { id: "satellite", label: "Satellite" },
  ];

  if (dark) {
    return (
      <div
        style={{
          display: "flex",
          borderRadius: 8,
          border: "1px solid rgba(74,222,128,0.2)",
          background: "rgba(74,222,128,0.04)",
          padding: 2,
          gap: 1,
        }}
      >
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => onChange(v.id)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: "pointer",
              border: "none",
              transition: "background 0.15s, color 0.15s",
              background: value === v.id ? "rgba(74,222,128,0.15)" : "transparent",
              color: value === v.id ? "#4ade80" : "rgba(74,222,128,0.35)",
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        borderRadius: 8,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "rgba(0,0,0,0.05)",
        padding: 2,
        gap: 1,
      }}
    >
      {views.map((v) => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            letterSpacing: "0.02em",
            cursor: "pointer",
            border: "none",
            transition: "background 0.15s, color 0.15s",
            background: value === v.id ? "#1A1510" : "transparent",
            color: value === v.id ? "#F5EBD4" : "rgba(26,21,16,0.45)",
          }}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DashboardClient({
  totalAnimals,
  campAnimalCounts,
  camps,
}: {
  totalAnimals: number;
  campAnimalCounts: Record<string, number>;
  camps: Camp[];
}) {
  const [viewMode, setViewMode]                 = useState<ViewMode>("tactical");
  const [filterBy, setFilterBy]                 = useState<FilterMode>("grazing");
  // Zoom state — driven by map clicks
  const [zoomedCampId, setZoomedCampId]         = useState<string | null>(null);
  // Panel state — driven by "View Full Details" button inside zoomed card
  const [selectedCampId, setSelectedCampId]     = useState<string | null>(null);
  const [selectedAnimalId, setSelectedAnimalId] = useState<string | null>(null);
  const [liveConditions, setLiveConditions]     = useState<Record<string, LiveCampStatus>>({});

  useEffect(() => {
    function fetchConditions() {
      fetch("/api/camps/status")
        .then((r) => r.ok ? r.json() : {})
        .then((data) => setLiveConditions(data ?? {}))
        .catch(() => {});
    }
    fetchConditions();
    const interval = setInterval(fetchConditions, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Reset zoom when switching views
  useEffect(() => {
    setZoomedCampId(null);
  }, [viewMode]);

  const panelOpen  = selectedCampId !== null || selectedAnimalId !== null;
  const isTactical = viewMode === "tactical";

  const today = new Date().toDateString();
  const inspectedToday = Object.values(liveConditions).filter(
    (c) => new Date(c.last_inspected_at).toDateString() === today
  ).length;
  const alertCount = Object.values(liveConditions).filter(
    (c) => c.grazing_quality === "Poor" || c.fence_status !== "Intact"
  ).length;

  const campData = camps.map((camp) => ({
    camp,
    stats: { total: campAnimalCounts[camp.camp_id] ?? 0, byCategory: {} as Record<string, number> },
    grazing: liveConditions[camp.camp_id]?.grazing_quality ?? "Fair",
  }));

  function handleCampClick(campId: string) {
    setZoomedCampId(campId);
    setSelectedCampId(campId);
  }

  return (
    <div
      className="relative flex flex-col"
      style={{ height: "100svh", background: isTactical ? "#070B0F" : "#1A1510" }}
    >
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          background: isTactical ? "#070B0F" : "#FFFFFF",
          borderBottom: `1px solid ${isTactical ? "rgba(74,222,128,0.12)" : "rgba(0,0,0,0.1)"}`,
          gap: 12,
          zIndex: 30,
          transition: "background 0.3s, border-color 0.3s",
        }}
      >
        {/* Logotype */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span
              style={{
                fontFamily: "var(--font-dm-serif)",
                fontSize: 20,
                color: isTactical ? "#4ade80" : "#1A1510",
                lineHeight: 1,
                transition: "color 0.3s",
              }}
            >
              FarmTrack
            </span>
            {isTactical && (
              <span
                style={{
                  fontSize: 9,
                  color: "rgba(74,222,128,0.5)",
                  fontFamily: "var(--font-sans)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                TACTICAL
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 9,
              color: isTactical ? "rgba(74,222,128,0.35)" : "rgba(26,21,16,0.45)",
              fontFamily: "var(--font-sans)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginTop: 2,
              transition: "color 0.3s",
            }}
          >
            {isTactical ? "COMMAND · PRECISION AGRICULTURE" : `Map Center · ${getTodayShort()}`}
          </div>
        </div>

        {/* Summary stats */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
          style={{ display: "flex", gap: 6, flex: 1, justifyContent: "center" }}
        >
          <StatChip label="Total Animals"   value={totalAnimals}                        dark={isTactical} />
          <StatChip label="Inspected"       value={`${inspectedToday}/${camps.length}`} dark={isTactical} />
          <StatChip label="Active Alerts"   value={alertCount} accent={alertCount > 0} pulse={alertCount > 0} dark={isTactical} />
          <StatChip label="Outstanding Obs" value={alertCount}                          dark={isTactical} />
        </motion.div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {(viewMode === "schematic" || viewMode === "tactical") && (
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as FilterMode)}
              style={{
                background: isTactical ? "rgba(74,222,128,0.06)" : "rgba(0,0,0,0.04)",
                border: `1px solid ${isTactical ? "rgba(74,222,128,0.2)" : "rgba(0,0,0,0.12)"}`,
                color: isTactical ? "#4ade80" : "#1A1510",
                borderRadius: 8,
                padding: "4px 8px",
                fontSize: 11,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <ViewToggle value={viewMode} onChange={setViewMode} dark={isTactical} />
          <SignOutButton />
        </div>
      </div>

      {/* ── Morning briefing strip (hidden in Tactical) ───────────────── */}
      <AnimatePresence>
        {viewMode !== "tactical" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 24 }}
            style={{ flexShrink: 0, overflow: "hidden" }}
          >
            <div
              style={{
                padding: "6px 16px",
                background: "#1A1510",
                borderBottom: "1px solid rgba(139,105,20,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, color: "rgba(210,180,140,0.7)", fontFamily: "var(--font-sans)" }}>
                {getGreeting()} — {getTodayShort()}
              </span>
              {alertCount > 0 && (
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: "#B03030",
                  fontWeight: 600,
                  fontFamily: "var(--font-sans)",
                }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#B03030",
                    display: "inline-block",
                    animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
                  }} />
                  {alertCount} open alert{alertCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main content area ─────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex" }}>
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {viewMode === "tactical" && (
            <TacticalMap
              onCampClick={handleCampClick}
              filterBy={filterBy}
              selectedCampId={selectedCampId}
              liveConditions={liveConditions}
              camps={camps}
              campAnimalCounts={campAnimalCounts}
            />
          )}
          {viewMode === "schematic" && (
            <SchematicMap
              onCampClick={handleCampClick}
              filterBy={filterBy}
              selectedCampId={selectedCampId}
              liveConditions={liveConditions}
              camps={camps}
              campAnimalCounts={campAnimalCounts}
            />
          )}
          {viewMode === "satellite" && (
            <div className="absolute inset-0">
              <FarmMap
                campData={campData}
                onCampClick={handleCampClick}
              />
            </div>
          )}
        </div>

        {/* ── Side panel (opened via "View Full Details") ─────────────── */}
        <AnimatePresence>
          {panelOpen && (
            <motion.div
              key={selectedAnimalId ?? selectedCampId}
              initial={{ x: 380, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 380, opacity: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 24 }}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: 380,
                boxShadow: "-8px 0 40px rgba(0,0,0,0.6)",
                zIndex: 20,
              }}
            >
              {selectedAnimalId ? (
                <AnimalProfile
                  animalId={selectedAnimalId}
                  onClose={() => { setSelectedAnimalId(null); setSelectedCampId(null); }}
                  onBack={() => setSelectedAnimalId(null)}
                />
              ) : (
                <CampDetailPanel
                  campId={selectedCampId!}
                  camp={camps.find((c) => c.camp_id === selectedCampId)}
                  onClose={() => setSelectedCampId(null)}
                  onSelectAnimal={(id) => setSelectedAnimalId(id)}
                  liveCondition={liveConditions[selectedCampId!]}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
