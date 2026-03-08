"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import CampDetailPanel from "./CampDetailPanel";
import AnimalProfile from "./AnimalProfile";
import SchematicMap, { type FilterMode } from "./SchematicMap";
import { getTotalAnimals, getInspectedToday, getAlertCount, getCampStats, getLastInspection } from "@/lib/utils";
import { CAMPS } from "@/lib/dummy-data";

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
        <p className="text-sm" style={{ color: "#8B6914" }}>Satelliet kaart laai...</p>
      </div>
    </div>
  ),
});

// ─── Date helper ──────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Des"];
function getTodayShort(): string {
  const now = new Date();
  return `${now.getDate()} ${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
}

// ─── Filter options ───────────────────────────────────────────────────────────

const FILTER_OPTIONS: { value: FilterMode; label: string }[] = [
  { value: "grazing",  label: "Beweidingskwaliteit" },
  { value: "water",    label: "Waterstatus"          },
  { value: "density",  label: "Besettingsdigtheid"   },
  { value: "days",     label: "Dae Sedert Inspeksie" },
];

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div
      style={{
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
    </div>
  );
}

// ─── View toggle ──────────────────────────────────────────────────────────────

function ViewToggle({
  value,
  onChange,
}: {
  value: "schematic" | "satellite";
  onChange: (v: "schematic" | "satellite") => void;
}) {
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
      {(["schematic", "satellite"] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
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
            background: value === mode ? "#1A1510" : "transparent",
            color: value === mode ? "#F5EBD4" : "rgba(26,21,16,0.45)",
          }}
        >
          {mode === "schematic" ? "Skematies" : "Satelliet"}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DashboardClient() {
  const [selectedCampId, setSelectedCampId]   = useState<string | null>(null);
  const [selectedAnimalId, setSelectedAnimalId] = useState<string | null>(null);
  const [viewMode, setViewMode]               = useState<"schematic" | "satellite">("schematic");
  const [filterBy, setFilterBy]               = useState<FilterMode>("grazing");

  const panelOpen = selectedCampId !== null || selectedAnimalId !== null;

  const totalAnimals    = getTotalAnimals();
  const inspectedToday  = getInspectedToday();
  const alertCount      = getAlertCount();

  const campData = CAMPS.map((camp) => ({
    camp,
    stats: getCampStats(camp.camp_id),
    grazing: getLastInspection(camp.camp_id)?.grazing_quality ?? "Fair",
  }));

  function handleCampClick(campId: string) {
    setSelectedCampId(campId);
    setSelectedAnimalId(null);
  }

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
        {/* Farm logotype */}
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
              Trio B
            </span>
            <span
              style={{
                fontFamily: "var(--font-dm-serif)",
                fontSize: 13,
                color: "#8B6914",
                lineHeight: 1,
              }}
            >
              Boerdery
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
            Kaart Sentrum · {getTodayShort()}
          </div>
        </div>

        {/* Summary stats */}
        <div style={{ display: "flex", gap: 6, flex: 1, justifyContent: "center" }}>
          <StatChip label="Totale Diere"    value={totalAnimals} />
          <StatChip label="Kampe Inspekteer" value={`${inspectedToday}/${CAMPS.length}`} />
          <StatChip label="Aktiewe Waarskuwings" value={alertCount} accent={alertCount > 0} />
          <StatChip label="Uitstaande Obs."  value={alertCount} />
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* Filter — only relevant for schematic view */}
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

          {/* View toggle */}
          <ViewToggle value={viewMode} onChange={setViewMode} />

          {/* Home link */}
          <Link
            href="/"
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              fontSize: 11,
              fontFamily: "var(--font-sans)",
              color: "rgba(26,21,16,0.55)",
              border: "1px solid rgba(0,0,0,0.1)",
              background: "rgba(0,0,0,0.04)",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            ← Tuisblad
          </Link>
        </div>
      </div>

      {/* ── Main content area ─────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex" }}>
        {/* Map / Schematic area */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {viewMode === "schematic" ? (
            <SchematicMap
              onCampClick={handleCampClick}
              filterBy={filterBy}
              selectedCampId={selectedCampId}
            />
          ) : (
            <div className="absolute inset-0">
              <FarmMap campData={campData} onCampClick={handleCampClick} />
            </div>
          )}
        </div>

        {/* ── Side panel ─────────────────────────────────────────────── */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: 380,
            transform: panelOpen ? "translateX(0)" : "translateX(100%)",
            transition: "transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)",
            boxShadow: panelOpen ? "-8px 0 40px rgba(0,0,0,0.6)" : "none",
            zIndex: 20,
          }}
        >
          {selectedAnimalId ? (
            <AnimalProfile
              animalId={selectedAnimalId}
              onClose={() => { setSelectedAnimalId(null); setSelectedCampId(null); }}
              onBack={() => setSelectedAnimalId(null)}
            />
          ) : selectedCampId ? (
            <CampDetailPanel
              campId={selectedCampId}
              onClose={() => setSelectedCampId(null)}
              onSelectAnimal={(id) => setSelectedAnimalId(id)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
