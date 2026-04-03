"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { LiveCampStatus } from "@/lib/server/camp-status";
import dynamic from "next/dynamic";
import { SignOutButton } from "@/components/logger/SignOutButton";
import CampDetailPanel from "./CampDetailPanel";
import AnimalProfile from "./AnimalProfile";
import SchematicMap, { type FilterMode } from "./SchematicMap";
import WeatherWidget from "./WeatherWidget";
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

export type ViewMode = "schematic" | "satellite";

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
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const views: { id: ViewMode; label: string }[] = [
    { id: "schematic", label: "Schematic" },
    { id: "satellite", label: "Satellite" },
  ];

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
  latitude,
  longitude,
}: {
  totalAnimals: number;
  campAnimalCounts: Record<string, number>;
  camps: Camp[];
  latitude?: number | null;
  longitude?: number | null;
}) {
  const router = useRouter();
  const [viewMode, setViewMode]                 = useState<ViewMode>("schematic");
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

  const panelOpen = selectedCampId !== null || selectedAnimalId !== null;

  const today = new Date().toDateString();
  const inspectedToday = Object.values(liveConditions).filter(
    (c) => new Date(c.last_inspected_at).toDateString() === today
  ).length;
  const alertCount = Object.values(liveConditions).filter(
    (c) => c.grazing_quality === "Poor" || c.fence_status !== "Intact"
  ).length;

  const campData = camps.map((camp) => {
    const cond = liveConditions[camp.camp_id];
    const lastDate = cond?.last_inspected_at ? new Date(cond.last_inspected_at) : null;
    const daysSince = lastDate ? Math.floor((Date.now() - lastDate.getTime()) / 86_400_000) : undefined;

    return {
      camp,
      stats: { total: campAnimalCounts[camp.camp_id] ?? 0, byCategory: {} as Record<string, number> },
      grazing: cond?.grazing_quality ?? "Fair",
      waterStatus: cond?.water_status,
      fenceStatus: cond?.fence_status,
      lastInspected: cond?.last_inspected_at,
      daysSinceInspection: daysSince,
    };
  });

  function handleCampClick(campId: string) {
    setZoomedCampId(campId);
    setSelectedCampId(campId);
  }

  function handleViewDetails(campId: string) {
    setSelectedCampId(campId);
  }

  const handleBoundaryDrawn = useCallback(
    async (campId: string | null, geojson: string, hectares: number, campName?: string) => {
      try {
        if (campId) {
          // Assign boundary to existing camp
          await fetch(`/api/camps/${encodeURIComponent(campId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ geojson, sizeHectares: hectares }),
          });
        } else {
          // Create new camp — use provided name or fallback
          const name = campName || `Camp ${camps.length + 1}`;
          await fetch("/api/camps", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campId: name.toLowerCase().replace(/\s+/g, "-"),
              campName: name,
              sizeHectares: hectares,
              geojson,
            }),
          });
        }
        router.refresh();
      } catch {
        // Silently handle — user will see stale data until next refresh
      }
    },
    [camps.length, router]
  );

  return (
    <div
      className="relative flex flex-col"
      style={{ height: "100svh", background: "#1A1510" }}
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
          background: "#FFFFFF",
          borderBottom: "1px solid rgba(0,0,0,0.1)",
          gap: 12,
          zIndex: 30,
        }}
      >
        {/* Logotype */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span
              style={{
                fontFamily: "var(--font-dm-serif)",
                fontSize: 20,
                color: "#1A1510",
                lineHeight: 1,
              }}
            >
              FarmTrack
            </span>
          </div>
          <div
            style={{
              fontSize: 9,
              color: "rgba(26,21,16,0.45)",
              fontFamily: "var(--font-sans)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginTop: 2,
            }}
          >
            {`Map Center · ${getTodayShort()}`}
          </div>
        </div>

        {/* Summary stats */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
          style={{ display: "flex", gap: 6, flex: 1, justifyContent: "center" }}
        >
          <StatChip label="Total Animals"   value={totalAnimals}                        />
          <StatChip label="Inspected"       value={`${inspectedToday}/${camps.length}`} />
          <StatChip label="Active Alerts"   value={alertCount} accent={alertCount > 0} pulse={alertCount > 0} />
          <StatChip label="Outstanding Obs" value={alertCount}                          />
        </motion.div>

        {/* Weather widget */}
        <div style={{ flexShrink: 0, maxWidth: 380 }}>
          <WeatherWidget latitude={latitude} longitude={longitude} />
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {viewMode === "schematic" && (
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as FilterMode)}
              style={{
                background: "rgba(0,0,0,0.04)",
                border: "1px solid rgba(0,0,0,0.12)",
                color: "#1A1510",
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
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <SignOutButton />
        </div>
      </div>

      {/* ── Morning briefing strip ────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
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

      {/* ── Main content area ─────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex" }}>
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {viewMode === "schematic" && (
            <SchematicMap
              onCampClick={handleCampClick}
              onViewDetails={handleViewDetails}
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
                onBoundaryDrawn={handleBoundaryDrawn}
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
