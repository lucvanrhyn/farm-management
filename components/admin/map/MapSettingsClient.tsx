"use client";

/**
 * MapSettingsClient — /admin/settings/map two-tab UI.
 *
 * Layers tab: 9 toggles mirroring `LayerToggle`. The 4 moat toggles
 *   (AFIS, FMD, Eskom, MTN) are visually disabled for Basic tier with
 *   an "Advanced" badge and a link to the upgrade page. Persists to
 *   localStorage under `farmtrack.map.layers` — same key the live map
 *   panel reads.
 *
 * GIS tab: EskomSePush area selector (persisted to FarmSettings.mapSettings
 *   JSON via /api/farm-settings/map) + read-only FMD-zone assertion
 *   (computed server-side from camp centroid, delivered as prop).
 *
 * No module-load env reads, immutable state updates throughout.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LayerState } from "@/components/map/LayerToggle";
import {
  DEFAULT_LAYER_STATE,
  readLayerState,
} from "@/components/map/LayerToggle";
import type { FarmTier } from "@/lib/tier";
import type { FarmMapSettings } from "@/app/api/farm-settings/map/schema";

// ── Types ─────────────────────────────────────────────────────────────────

export type FmdZoneResult =
  | { status: "inside"; zoneName: string; centroid: { lng: number; lat: number } }
  | { status: "outside"; centroid: { lng: number; lat: number } }
  | { status: "unknown"; centroid?: { lng: number; lat: number } };

interface Props {
  farmSlug: string;
  tier: FarmTier;
  initialSettings: FarmMapSettings;
  fmdZone: FmdZoneResult;
}

const STORAGE_KEY = "farmtrack.map.layers";

type TabKey = "layers" | "gis";

interface LayerOption {
  key: keyof LayerState;
  label: string;
  description: string;
  moat: boolean; // true = Advanced-only
}

const LAYER_OPTIONS: LayerOption[] = [
  { key: "campOverlay",    label: "Camp overlay",   description: "Coloured camp polygons with live condition tint.", moat: false },
  { key: "taskPins",       label: "Tasks",          description: "Pending task pins pulled from the Task Inbox.",    moat: false },
  { key: "waterPoints",    label: "Water points",   description: "Troughs, dams, and boreholes.",                    moat: false },
  { key: "infrastructure", label: "Fences & roads", description: "Camp boundaries and track network.",               moat: false },
  { key: "rainfallGauges", label: "Rainfall",       description: "Recent daily rainfall totals per gauge.",          moat: false },
  { key: "afisFire",       label: "AFIS fires",     description: "Active fire hot-spots from CSIR AFIS.",            moat: true },
  { key: "fmdZones",       label: "FMD red line",   description: "Foot-and-mouth control zone polygons.",            moat: true },
  { key: "eskomBanner",    label: "Load-shedding",  description: "Eskom schedule for your area banner.",             moat: true },
  { key: "mtnCoverage",    label: "MTN coverage",   description: "Cellular coverage heatmap overlay.",               moat: true },
];

// Hard-coded SA area list — the EskomSePush search endpoint is paid, so we
// ship a minimal set of common provinces/metros. Admins needing a specific
// sub-area can paste the raw id as "custom" via a text input.
const ESKOM_AREAS: Array<{ id: string; label: string }> = [
  { id: "eskde-10-johannesburgcityofjohannesburgmetropolitanmunicipalitygauteng", label: "Johannesburg — City of Joburg Metro" },
  { id: "eskde-13-capetowncitytownmetropolitanmunicipalitywesterncape",           label: "Cape Town — City of Cape Town Metro" },
  { id: "eskde-14-ekurhulenicitytownmetropolitanmunicipalitygauteng",             label: "Ekurhuleni Metro (Gauteng)" },
  { id: "eskde-7-pretoriatshwanemetropolitanmunicipalitygauteng",                 label: "Tshwane / Pretoria (Gauteng)" },
  { id: "eskde-3-durbanethekwinimetropolitanmunicipalitykwazulunatal",            label: "eThekwini / Durban (KZN)" },
  { id: "eskde-6-portelizabethnelsonmandelabaymetropolitanmunicipalityeastcape",  label: "Nelson Mandela Bay / Gqeberha (EC)" },
  { id: "eskde-9-bloemfonteinmangaungmetropolitanmunicipalityfreestate",          label: "Mangaung / Bloemfontein (FS)" },
  { id: "eskde-16-buffalocityeastlondonmetropolitanmunicipalityeastcape",         label: "Buffalo City / East London (EC)" },
];

// ── Root ─────────────────────────────────────────────────────────────────

export default function MapSettingsClient({
  farmSlug,
  tier,
  initialSettings,
  fmdZone,
}: Props) {
  const [tab, setTab] = useState<TabKey>("layers");
  return (
    <div>
      <div
        role="tablist"
        aria-label="Map settings tabs"
        className="flex gap-1 border-b mb-6"
        style={{ borderColor: "rgba(156,142,122,0.25)" }}
      >
        <TabButton tab="layers" current={tab} onSelect={setTab} label="Layers" />
        <TabButton tab="gis" current={tab} onSelect={setTab} label="GIS" />
      </div>

      {tab === "layers" ? (
        <LayersTab farmSlug={farmSlug} tier={tier} />
      ) : (
        <GisTab initialSettings={initialSettings} fmdZone={fmdZone} />
      )}
    </div>
  );
}

function TabButton({
  tab,
  current,
  onSelect,
  label,
}: {
  tab: TabKey;
  current: TabKey;
  onSelect: (t: TabKey) => void;
  label: string;
}) {
  const isActive = tab === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={`mapset-panel-${tab}`}
      id={`mapset-tab-${tab}`}
      onClick={() => onSelect(tab)}
      className="px-4 py-2 text-sm font-medium transition-colors"
      style={{
        color: isActive ? "#1C1815" : "#9C8E7A",
        borderBottom: isActive ? "2px solid #8B6914" : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );
}

// ── Layers tab ───────────────────────────────────────────────────────────

function LayersTab({ farmSlug, tier }: { farmSlug: string; tier: FarmTier }) {
  const [state, setState] = useState<LayerState>(DEFAULT_LAYER_STATE);
  const [hydrated, setHydrated] = useState(false);
  const isBasic = tier === "basic";

  useEffect(() => {
    setState(readLayerState());
    setHydrated(true);
  }, []);

  const toggle = useCallback((key: keyof LayerState) => {
    setState((prev) => {
      const next: LayerState = { ...prev, [key]: !prev[key] };
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // storage quota / privacy mode — toggles still update in-memory.
        }
      }
      return next;
    });
  }, []);

  return (
    <div id="mapset-panel-layers" role="tabpanel" aria-labelledby="mapset-tab-layers">
      <p className="text-sm mb-4" style={{ color: "#6B5E48" }}>
        Choose which layers appear on the FarmMap. Settings persist on this device.
      </p>

      <ul className="flex flex-col gap-2">
        {LAYER_OPTIONS.map((opt) => {
          const locked = opt.moat && isBasic;
          const checked = hydrated ? state[opt.key] : DEFAULT_LAYER_STATE[opt.key];
          return (
            <li
              key={opt.key}
              className="rounded-lg border px-4 py-3 flex items-start gap-3"
              style={{
                borderColor: "rgba(156,142,122,0.25)",
                background: locked ? "rgba(156,142,122,0.04)" : "#FFFFFF",
                opacity: locked ? 0.7 : 1,
              }}
            >
              <input
                type="checkbox"
                id={`layer-${opt.key}`}
                checked={locked ? false : checked}
                disabled={locked}
                onChange={() => toggle(opt.key)}
                className="mt-0.5"
              />
              <label
                htmlFor={`layer-${opt.key}`}
                className="flex-1"
                style={{ cursor: locked ? "not-allowed" : "pointer" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "#1C1815" }}>
                    {opt.label}
                  </span>
                  {opt.moat && (
                    <span
                      className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded-full"
                      style={{
                        background: "rgba(139,105,20,0.15)",
                        color: "#8B6914",
                      }}
                    >
                      Advanced
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
                  {opt.description}
                </p>
              </label>
              {locked && (
                <Link
                  href={`/${farmSlug}/subscribe/upgrade`}
                  className="shrink-0 self-center text-xs font-medium underline"
                  style={{ color: "#8B6914" }}
                >
                  Upgrade
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── GIS tab ──────────────────────────────────────────────────────────────

function GisTab({
  initialSettings,
  fmdZone,
}: {
  initialSettings: FarmMapSettings;
  fmdZone: FmdZoneResult;
}) {
  const [settings, setSettings] = useState<FarmMapSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  const currentAreaKnown = ESKOM_AREAS.some((a) => a.id === settings.eskomAreaId);

  const saveArea = useCallback(
    async (next: string | null) => {
      setSettings((prev) => ({ ...prev, eskomAreaId: next }));
      setSaving(true);
      setErrorMessage(null);
      try {
        const res = await fetch("/api/farm-settings/map", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eskomAreaId: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
          const code = body.code ?? "SAVE_FAILED";
          setErrorMessage(
            code === "MISSING_ADMIN_SESSION"
              ? "Please sign in again."
              : code === "FORBIDDEN"
                ? "Only admins can update GIS settings."
                : code === "INVALID_FIELD"
                  ? (body.error ?? "Invalid area id.")
                  : (body.error ?? "Save failed — try again."),
          );
          setStatus("error");
          return;
        }
        const saved = (await res.json()) as FarmMapSettings;
        setSettings(saved);
        setStatus("saved");
      } catch {
        setErrorMessage("Network error — try again.");
        setStatus("error");
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  return (
    <div id="mapset-panel-gis" role="tabpanel" aria-labelledby="mapset-tab-gis" className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-semibold mb-2" style={{ color: "#1C1815" }}>
          EskomSePush area
        </h2>
        <p className="text-xs mb-3" style={{ color: "#9C8E7A" }}>
          Select your load-shedding area so the map banner and alert engine can pull the right schedule.
        </p>

        <select
          value={settings.eskomAreaId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            saveArea(v || null);
          }}
          disabled={saving}
          className="w-full max-w-md rounded border px-3 py-2 text-sm"
          style={{ borderColor: "rgba(156,142,122,0.4)" }}
        >
          <option value="">No area selected</option>
          {ESKOM_AREAS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          {settings.eskomAreaId && !currentAreaKnown && (
            <option value={settings.eskomAreaId}>
              Custom: {settings.eskomAreaId.slice(0, 40)}…
            </option>
          )}
        </select>

        {errorMessage && (
          <div
            role="alert"
            className="mt-3 rounded-lg border px-3 py-2 text-sm"
            style={{
              background: "rgba(220,38,38,0.08)",
              borderColor: "rgba(220,38,38,0.4)",
              color: "#b91c1c",
            }}
          >
            {errorMessage}
          </div>
        )}

        {status === "saved" && (
          <p className="text-xs mt-2" style={{ color: "#0f766e" }}>
            Saved.
          </p>
        )}
      </section>

      <section
        className="rounded-lg border px-4 py-3"
        style={{ borderColor: "rgba(156,142,122,0.25)", background: "#FFFFFF" }}
      >
        <h2 className="text-sm font-semibold mb-1" style={{ color: "#1C1815" }}>
          FMD red-line zone
        </h2>
        <p className="text-xs mb-2" style={{ color: "#9C8E7A" }}>
          Computed from your camp polygons vs. the published DALRRD foot-and-mouth control zones.
        </p>
        <FmdZoneBadge result={fmdZone} />
      </section>
    </div>
  );
}

function FmdZoneBadge({ result }: { result: FmdZoneResult }) {
  if (result.status === "inside") {
    return (
      <p className="text-sm" style={{ color: "#b45309" }}>
        Your farm centroid is <strong>inside the FMD control zone</strong>: {result.zoneName}.
        Statutory movement restrictions apply.
      </p>
    );
  }
  if (result.status === "outside") {
    return (
      <p className="text-sm" style={{ color: "#0f766e" }}>
        Your farm centroid is <strong>outside</strong> the FMD red-line control zone.
      </p>
    );
  }
  return (
    <p className="text-sm" style={{ color: "#6B5E48" }}>
      FMD zone status unavailable — add camp polygons on the FarmMap to enable this check.
    </p>
  );
}
