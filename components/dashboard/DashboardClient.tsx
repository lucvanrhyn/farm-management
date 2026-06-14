"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { LiveCampStatus } from "@/lib/server/camp-status";
import { composeAlerts } from "@/lib/server/alerts/compose";
import dynamic from "next/dynamic";
import { SignOutButton } from "@/components/logger/SignOutButton";
import SchematicMap, { type FilterMode } from "./SchematicMap";
import WeatherWidget from "./WeatherWidget";
import type { Camp } from "@/lib/types";
import { useFarmModeSafe, type FarmMode } from "@/lib/farm-mode";
import { useClientTime } from "@/lib/hooks/use-client-time";

// Wave A3 — labels for the per-species chip in the dashboard header.
// Inlined rather than imported from `lib/species/registry` to keep the
// dashboard route's initial JS bundle lean (registry pulls every species
// module). Three keys, hand-maintained alongside `FarmMode`.
const MODE_LABELS: Record<FarmMode, string> = {
  cattle: "Cattle",
  sheep: "Sheep",
  game: "Game",
};

// Phase M: framer-motion used to be imported statically here for the
// header stats strip and the slide-in side panel. It's now split into
// two dynamic-only chunks so the dashboard route ships without the
// animation library in its initial JS bundle.
const DashboardStatsStrip = dynamic(() => import("./DashboardStatsStrip"), {
  ssr: false,
  // Placeholder keeps the header centered while the chunk loads so the
  // surrounding layout doesn't jump.
  loading: () => (
    <div style={{ display: "flex", gap: 6, flex: 1, justifyContent: "center" }} aria-hidden />
  ),
});

const DashboardSidePanel = dynamic(() => import("./DashboardSidePanel"), {
  ssr: false,
});

// Leaflet must only render client-side
const FarmMap = dynamic(() => import("@/components/map/FarmMap"), {
  ssr: false,
  loading: () => (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: "var(--ft-text)" }}
    >
      <div className="text-center">
        <div
          className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
          style={{ borderColor: "var(--ft-fair)", borderTopColor: "transparent" }}
        />
        <p className="text-sm" style={{ color: "var(--ft-fair)" }}>Loading satellite map...</p>
      </div>
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewMode = "schematic" | "satellite";

// ADR-0005 — the header badge is a *partial pass* of the single alert
// composition core. Of the engine's eight sources only camp-conditions is
// available offline (it's what `/api/camps/status` returns); the partial
// pass therefore only ever surfaces poor-grazing / fence-damaged /
// stale-inspections. stale-inspections needs the inspection-age threshold,
// so we pass the documented engine defaults here. These mirror the
// `DEFAULT_THRESHOLDS` already used by the server callers
// (lib/server/notification-generator.ts, lib/server/alerts/legacy-dashboard.ts);
// the header can't read FarmSettings offline, so defaults are correct for an
// "at least N" prefix indicator. A future PR that wires real thresholds
// through can only raise the count toward canonical — never contradict it.
const HEADER_PARTIAL_THRESHOLDS = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  staleCampInspectionHours: 48,
} as const;

// Adapter: `/api/camps/status` returns a `Record<campId, LiveCampStatus>`
// (the offline-available shape). composeAlerts wants a Map. Pinning the
// conversion in one place is the ADR's "one adapter" requirement — the
// offline shape and the engine's `LiveCampStatus` are identical field-wise,
// so this is a pure container swap with no field remapping.
function liveConditionsToCampConditions(
  live: Record<string, LiveCampStatus>,
): Map<string, LiveCampStatus> {
  return new Map(Object.entries(live));
}

// ─── Date helper ──────────────────────────────────────────────────────────────

// Pure `(now) => string` mappings. They are NEVER called in the render body
// directly — only via `useClientTime`, which gates them behind mount so the
// server (UTC) render and the client's first render agree. See issue #283 /
// lib/hooks/use-client-time.ts for the hydration rationale.
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatTodayShort(now: Date): string {
  return `${now.getDate()} ${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
}

// ─── Filter options ───────────────────────────────────────────────────────────

const FILTER_OPTIONS: { value: FilterMode; label: string }[] = [
  { value: "grazing",  label: "Grazing Quality" },
  { value: "water",    label: "Water Status"    },
  { value: "density",  label: "Stocking Density" },
  { value: "days",     label: "Days Since Inspection" },
];

// ─── Morning briefing helper ──────────────────────────────────────────────────

function computeGreeting(now: Date): string {
  const h = now.getHours();
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
            background: value === v.id ? "var(--ft-text)" : "transparent",
            color: value === v.id ? "var(--ft-fair-bg)" : "rgba(26,21,16,0.45)",
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
  farmSlug,
  totalAnimals,
  totalBySpecies,
  campAnimalCounts,
  campCountsBySpecies,
  camps,
  latitude,
  longitude,
  censusCountByCamp,
  rotationByCampId,
  veldScoreByCamp,
  feedOnOfferKgDmPerHaByCamp,
}: {
  farmSlug: string;
  totalAnimals: number;
  totalBySpecies?: Record<string, number>;
  campAnimalCounts: Record<string, number>;
  campCountsBySpecies?: Record<string, Record<string, number>>;
  camps: Camp[];
  latitude?: number | null;
  longitude?: number | null;
  censusCountByCamp?: Record<string, number>;
  rotationByCampId?: Record<string, { status: "grazing" | "overstayed" | "resting" | "resting_ready" | "overdue_rest" | "unknown"; days: number | null }>;
  veldScoreByCamp?: Record<string, number>;
  feedOnOfferKgDmPerHaByCamp?: Record<string, number>;
}) {
  const router = useRouter();
  const { mode, isMultiMode } = useFarmModeSafe();

  // Wall-clock derived header strings. Routed through useClientTime so the
  // server (UTC) render and the client's first render are byte-identical —
  // the real localized values appear only after mount. Closes the recurring
  // React #418 on dashboard load (issue #283). Placeholders are stable,
  // clock-independent, and visually inert until the post-mount value lands.
  const greeting = useClientTime(computeGreeting, "Good day");
  const todayShort = useClientTime(formatTodayShort, "");
  // Empty string until mounted; once mounted it's the client's local
  // `toDateString()`, used purely for same-day comparison below.
  const today = useClientTime((now) => now.toDateString(), "");

  // Species-filtered counts — fall back to unfiltered totals
  const filteredTotal = totalBySpecies?.[mode] ?? totalAnimals;
  const filteredCampCounts = campCountsBySpecies?.[mode] ?? campAnimalCounts;

  // Wave 233: when the user flips the FarmMode toggle, trigger a server
  // re-render so the species-scoped camp.findMany in
  // `app/[farmSlug]/dashboard/page.tsx` re-runs with the new cookie. The
  // server then hands DashboardClient a fresh `camps` prop with only the
  // current-species camps. `router.refresh()` updates the RSC payload
  // without unmounting the client tree — no full page reload, as required
  // by issue #233.
  const lastModeRef = useRef(mode);
  useEffect(() => {
    if (lastModeRef.current !== mode) {
      lastModeRef.current = mode;
      router.refresh();
    }
  }, [mode, router]);
  const [viewMode, setViewMode]                 = useState<ViewMode>("schematic");
  const [filterBy, setFilterBy]                 = useState<FilterMode>("grazing");
  // Zoom state — driven by map clicks
  const [zoomedCampId, setZoomedCampId]         = useState<string | null>(null);
  // Panel state — driven by "View Full Details" button inside zoomed card
  const [selectedCampId, setSelectedCampId]     = useState<string | null>(null);
  const [selectedAnimalId, setSelectedAnimalId] = useState<string | null>(null);
  const [liveConditions, setLiveConditions]     = useState<Record<string, LiveCampStatus>>({});
  const [conditionsError, setConditionsError]   = useState(false);
  // Distinguishes "first response not yet received" from "server returned an
  // empty object." Without this the header KPIs render as 0/0/0 for 2–3s on
  // slow connections and users read that as "my farm has no activity."
  const [conditionsLoading, setConditionsLoading] = useState(true);

  useEffect(() => {
    // /api/camps/status is server-cached for 60s (see lib/server/cached.ts).
    // Polling faster than the cache TTL just burns requests without ever
    // seeing fresh data.
    const POLL_INTERVAL_MS = 60_000;
    let lastPayload = "";

    function fetchConditions() {
      // Skip while the tab is hidden — no user to show updates to.
      if (typeof document !== "undefined" && document.hidden) return;
      fetch("/api/camps/status")
        .then((r) => r.ok ? r.json() : {})
        .then((data) => {
          setConditionsError(false);
          // Preserve referential identity when nothing changed so React can
          // bail out and SchematicMap / side panel don't re-render.
          const serialized = JSON.stringify(data ?? {});
          if (serialized === lastPayload) return;
          lastPayload = serialized;
          setLiveConditions(data ?? {});
          setConditionsLoading(false);
        })
        .catch(() => {
          setConditionsError(true);
          setConditionsLoading(false);
        });
    }
    fetchConditions();
    const interval = setInterval(fetchConditions, POLL_INTERVAL_MS);
    // Refresh immediately when the user tabs back in.
    const onVisible = () => { if (!document.hidden) fetchConditions(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Reset zoom when switching views
  useEffect(() => {
    setZoomedCampId(null);
  }, [viewMode]);

  const panelOpen = selectedCampId !== null || selectedAnimalId !== null;

  // ADR-0005 — the header is a *partial pass* of the single composition
  // core, NOT a bespoke formula. We adapt the offline `liveConditions` into
  // the engine's campConditions Map once and feed it to `composeAlerts`.
  // `alertCount` is the partial pass's `.totalCount`; it is provably a
  // prefix of the full server pass (`/admin/alerts`) for the same farm — it
  // can only under-report toward the canonical number, never contradict it.
  // `inspectedToday` is derived from that SAME adapted map (single source of
  // truth for camp conditions) rather than a second copy of liveConditions.
  const campConditions = liveConditionsToCampConditions(liveConditions);
  const alerts = composeAlerts({
    campConditions,
    totalCamps: camps.length,
    thresholds: HEADER_PARTIAL_THRESHOLDS,
    farmSlug,
    // Wall-clock here is intentional and matches the existing `daysSince`
    // pattern below: `now` only feeds the stale-inspections age check, a
    // days-granularity derived value that updates when `liveConditions`
    // changes. The header already shows "—" until conditionsLoading clears.
    now: new Date(),
  });
  const alertCount = alerts.totalCount;
  // `today` is "" until mount (placeholder), so before hydration completes
  // no record matches and `inspectedToday` is 0 — consistent with the
  // server render. After mount it's the client-local day and the count is
  // accurate. The header already shows "—" while `conditionsLoading`.
  const inspectedToday = today
    ? [...campConditions.values()].filter(
        (c) => new Date(c.last_inspected_at).toDateString() === today,
      ).length
    : 0;

  const campData = camps.map((camp) => {
    const cond = liveConditions[camp.camp_id];
    const lastDate = cond?.last_inspected_at ? new Date(cond.last_inspected_at) : null;
    // Wall-clock here is intentional: `daysSince` is a UI-only derived value
    // that updates when `liveConditions` changes. Days-granularity drift is
    // acceptable without a ticking effect.
    // eslint-disable-next-line react-hooks/purity
    const daysSince = lastDate ? Math.floor((Date.now() - lastDate.getTime()) / 86_400_000) : undefined;

    return {
      camp,
      stats: { total: filteredCampCounts[camp.camp_id] ?? 0, byCategory: {} as Record<string, number> },
      grazing: cond?.grazing_quality ?? "Fair",
      waterStatus: cond?.water_status,
      fenceStatus: cond?.fence_status,
      lastInspected: cond?.last_inspected_at,
      daysSinceInspection: daysSince,
      censusPopulation: censusCountByCamp?.[camp.camp_id] ?? 0,
      rotationStatus: rotationByCampId?.[camp.camp_id]?.status,
      rotationDays: rotationByCampId?.[camp.camp_id]?.days ?? null,
      veldScore: veldScoreByCamp?.[camp.camp_id] ?? null,
      feedOnOfferKgDmPerHa: feedOnOfferKgDmPerHaByCamp?.[camp.camp_id] ?? null,
    };
  });

  function handleCampClick(campId: string) {
    setZoomedCampId(campId);
    setSelectedCampId(campId);
  }

  function handleViewDetails(campId: string) {
    // Codex audit C4 (2026-05-10): the "View Full Details →" CTA inside the
    // schematic zoom card has nav affordance (label + arrow) but used to
    // pop a side-panel overlay, leaving users on /dashboard. Route to the
    // real per-camp page instead — the same surface OverviewTab and
    // AnimalsTable already link to.
    router.push(`/${farmSlug}/dashboard/camp/${campId}`);
  }

  const [boundaryError, setBoundaryError] = useState<string | null>(null);

  const handleBoundaryDrawn = useCallback(
    async (campId: string | null, geojson: string, hectares: number, campName?: string) => {
      setBoundaryError(null);
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
          const slug = `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36)}`;
          await fetch("/api/camps", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campId: slug,
              campName: name,
              sizeHectares: hectares,
              geojson,
            }),
          });
        }
        router.refresh();
      } catch {
        setBoundaryError("Failed to save boundary. Please try again.");
      }
    },
    [camps.length, router]
  );

  return (
    <div
      className="relative flex flex-col"
      style={{ height: "100svh", background: "var(--ft-text)" }}
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
          background: "var(--ft-surface)",
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
                color: "var(--ft-text)",
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
            {todayShort ? `Map Center · ${todayShort}` : "Map Center"}
          </div>
        </div>

        {/* Summary stats — framer-motion loaded lazily (see dynamic() above).
            Wave A3 (Codex C2 follow-up): on multi-species farms, also pass
            the cross-species Total so DashboardStatsStrip can render a
            second chip alongside the mode-filtered count. Single-species
            tenants get the legacy single-chip layout untouched. */}
        <DashboardStatsStrip
          totalAnimals={filteredTotal}
          inspectedLabel={conditionsLoading ? "—" : `${inspectedToday}/${camps.length}`}
          alertLabel={conditionsLoading ? "—" : alertCount}
          alertAccent={!conditionsLoading && alertCount > 0}
          alertPulse={!conditionsLoading && alertCount > 0}
          crossSpeciesTotal={isMultiMode ? totalAnimals : undefined}
          modeLabel={isMultiMode ? MODE_LABELS[mode] : undefined}
        />
        {conditionsError && (
          <span style={{ fontSize: 10, color: "rgba(239,68,68,0.7)", whiteSpace: "nowrap" }}>
            Live data unavailable
          </span>
        )}

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
                color: "var(--ft-text)",
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

      {/* Boundary save error */}
      {boundaryError && (
        <div
          style={{
            flexShrink: 0,
            padding: "6px 16px",
            background: "rgba(239,68,68,0.1)",
            color: "var(--ft-crit)",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{boundaryError}</span>
          <button
            onClick={() => setBoundaryError(null)}
            style={{ background: "none", border: "none", color: "var(--ft-crit)", cursor: "pointer", fontSize: 14 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Morning briefing strip ────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          padding: "6px 16px",
          background: "var(--ft-text)",
          borderBottom: "1px solid rgba(139,105,20,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, color: "rgba(210,180,140,0.7)", fontFamily: "var(--font-sans)" }}>
          {todayShort ? `${greeting} — ${todayShort}` : greeting}
        </span>
        {alertCount > 0 && (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            color: "var(--ft-crit)",
            fontWeight: 600,
            fontFamily: "var(--font-sans)",
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--ft-crit)",
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
              campAnimalCounts={filteredCampCounts}
            />
          )}
          {viewMode === "satellite" && (
            <div className="absolute inset-0">
              <FarmMap
                campData={campData}
                onCampClick={handleCampClick}
                onBoundaryDrawn={handleBoundaryDrawn}
                latitude={latitude}
                longitude={longitude}
              />
            </div>
          )}
        </div>

        {/* ── Side panel (opened via "View Full Details") ───────────────
             framer-motion + AnimatePresence loaded lazily via
             next/dynamic — chunk only downloads when a user opens the
             panel, not on first paint of the dashboard. */}
        <DashboardSidePanel
          panelOpen={panelOpen}
          selectedCampId={selectedCampId}
          selectedAnimalId={selectedAnimalId}
          camps={camps}
          liveConditions={liveConditions}
          onSelectAnimal={(id) => setSelectedAnimalId(id)}
          onCloseAnimal={() => { setSelectedAnimalId(null); setSelectedCampId(null); }}
          onCloseCamp={() => setSelectedCampId(null)}
          onBackFromAnimal={() => setSelectedAnimalId(null)}
        />
      </div>
    </div>
  );
}
