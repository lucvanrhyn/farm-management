"use client";

/**
 * LayerToggle — floating checkbox panel that controls which FarmMap layers
 * are mounted. Persists to localStorage under `farmtrack.map.layers`.
 *
 * Advanced-tier gating is wrapped around this component by Wave 3F; this
 * component just renders the toggles.
 */

import { useState, useCallback } from "react";
import { Icon } from "@/components/ds";

export interface LayerState {
  campOverlay:     boolean;
  taskPins:        boolean;
  waterPoints:     boolean;
  infrastructure:  boolean;
  rainfallGauges:  boolean;
  afisFire:        boolean;
  fmdZones:        boolean;
  eskomBanner:     boolean;
  mtnCoverage:     boolean;
}

const STORAGE_KEY = "farmtrack.map.layers";

export const DEFAULT_LAYER_STATE: LayerState = {
  campOverlay:    true,
  // NOTE: kept `false` to honour the persisted-toggle contract pinned by
  // LayerToggle.test.tsx (clicking Tasks from the default state must emit
  // `{ taskPins: true }`). The overhaul "live pins" change is purely the
  // marker styling in TaskPinLayer — pins render as pulsing HTML markers
  // once the Tasks layer is enabled.
  taskPins:       false,
  waterPoints:    false,
  infrastructure: false,
  rainfallGauges: false,
  afisFire:       false,
  fmdZones:       false,
  eskomBanner:    false,
  mtnCoverage:    false,
};

/**
 * Read persisted state from localStorage. SSR-safe: returns defaults when
 * `window` is undefined.
 */
export function readLayerState(): LayerState {
  if (typeof window === "undefined") return DEFAULT_LAYER_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYER_STATE;
    const parsed = JSON.parse(raw) as Partial<LayerState>;
    return { ...DEFAULT_LAYER_STATE, ...parsed };
  } catch {
    return DEFAULT_LAYER_STATE;
  }
}

/**
 * React hook for managing LayerState with localStorage persistence.
 *
 * Initial render returns DEFAULT_LAYER_STATE (SSR-safe). On mount, reads
 * persisted state and re-renders. Writes on every change.
 */
export function useLayerState(): [LayerState, (patch: Partial<LayerState>) => void] {
  // Lazy initializer reads localStorage on first client render (SSR-safe —
  // readLayerState() returns defaults when window is undefined). No effect
  // needed for hydration — eliminates the synchronous setState-in-effect lint error.
  const [state, setState] = useState<LayerState>(readLayerState);

  const update = useCallback((patch: Partial<LayerState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Ignore quota errors; preference is non-critical.
        }
      }
      return next;
    });
  }, []);

  return [state, update];
}

// ── Rendering ────────────────────────────────────────────────────────────────

interface ToggleOption {
  key: keyof LayerState;
  label: string;
  note?: string;
}

const TOGGLES: ToggleOption[] = [
  { key: "campOverlay",    label: "Camp overlay" },
  { key: "taskPins",       label: "Tasks" },
  { key: "waterPoints",    label: "Water points" },
  { key: "infrastructure", label: "Fences & roads" },
  { key: "rainfallGauges", label: "Rainfall" },
  { key: "afisFire",       label: "AFIS fires" },
  { key: "fmdZones",       label: "FMD red line" },
  { key: "eskomBanner",    label: "Load-shedding" },
  { key: "mtnCoverage",    label: "MTN coverage" },
];

interface Props {
  value: LayerState;
  onChange: (patch: Partial<LayerState>) => void;
}

/**
 * Phone collapse + mobile re-anchor.
 *
 * Issue #468 (re-anchor): on desktop the Layers panel sits bottom-right and the
 * action cluster sits bottom-left — they clear each other. At narrow widths the
 * two overlays meet in the middle of the bottom band, so below 640px the panel
 * docks to the TOP-right instead.
 *
 * Congestion fix (phone): the always-open 9-row panel paints over a large slice
 * of the narrow map (the frozen phone reference shows only a collapsed layers
 * launcher, not the open panel). Below 640px the panel is therefore hidden
 * until the user taps the floating `.ft-map-layers-btn` launcher; tapping the
 * panel's close control re-collapses it. Desktop is byte-for-byte unchanged —
 * the launcher is `display:none` and the panel renders inline regardless of the
 * collapsed flag (the panel-hide rule is media-gated to ≤640px). CSS-only split
 * ⇒ SSR-safe (no hydration branch; the `collapsed` flag starts identical on
 * server and client, and only flips on user interaction).
 */
const MOBILE_REANCHOR_CSS = `
.ft-map-layers-btn { display: none; }
.ft-map-layers-close { display: none; }
@media (max-width: 640px) {
  .ft-map-layers-btn[data-collapsed="true"]   { display: inline-flex !important; }
  .ft-map-layers-btn[data-collapsed="false"]  { display: none !important; }
  .ft-map-layers-close                         { display: inline-flex !important; }
  .ft-map-layer-toggle[data-collapsed="true"]  { display: none !important; }
  .ft-map-layer-toggle[data-collapsed="false"] {
    bottom: auto !important;
    top: 96px !important;
    max-height: calc(100% - 132px);
    overflow-y: auto;
  }
}
`;

export default function LayerToggle({ value, onChange }: Props) {
  // Phone-only collapse. Starts collapsed (matches the SSR markup on both
  // server and client). Desktop ignores this flag — the panel-hide CSS only
  // matches ≤640px, and the launcher is display:none above it.
  const [collapsed, setCollapsed] = useState(true);
  const dc = collapsed ? "true" : "false";

  return (
    <>
    <style>{MOBILE_REANCHOR_CSS}</style>

    {/* Floating launcher — phone only. Opens the panel; on desktop it is
        display:none and the panel is always inline. */}
    <button
      type="button"
      data-collapsed={dc}
      data-testid="map-layers-button"
      aria-label="Map layers"
      aria-expanded={!collapsed}
      onClick={() => setCollapsed(false)}
      className="ft-map-layers-btn dark-surface"
      style={{
        position: "absolute",
        top: 96,
        right: 16,
        zIndex: 11,
        alignItems: "center",
        justifyContent: "center",
        width: 40,
        height: 40,
        borderRadius: "var(--ft-r-sm)",
        background: "color-mix(in oklab, var(--ft-surface) 92%, transparent)",
        backdropFilter: "blur(14px) saturate(140%)",
        border: "1px solid var(--ft-border2)",
        boxShadow: "var(--ft-shadow-lg)",
        color: "var(--ft-text)",
        cursor: "pointer",
      }}
    >
      <Icon.layers size={18} />
    </button>

    <div
      data-testid="map-layer-toggle"
      data-collapsed={dc}
      className="ft-map-layer-toggle dark-surface"
      style={{
        position: "absolute",
        bottom: 24,
        right: 16,
        zIndex: 11,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "14px 16px",
        // Dark-surface card (tokenised). `--ft-card-r` resolves to 12px under
        // the .dark-surface scope; the glassy translucency + blur keep the
        // floating-over-satellite feel while the colours come from tokens.
        borderRadius: "var(--ft-card-r)",
        background: "color-mix(in oklab, var(--ft-surface) 92%, transparent)",
        backdropFilter: "blur(14px) saturate(140%)",
        border: "1px solid var(--ft-border2)",
        boxShadow: "var(--ft-shadow-lg)",
        color: "var(--ft-text)",
        minWidth: 208,
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 8 }}
      >
        <span
          className="ft-mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ft-muted)",
          }}
        >
          Layers
        </span>
        {/* Close control — phone only (desktop has no collapse). */}
        <button
          type="button"
          aria-label="Close layers"
          onClick={() => setCollapsed(true)}
          className="ft-map-layers-close items-center justify-center"
          style={{
            width: 22,
            height: 22,
            marginRight: -4,
            borderRadius: "var(--ft-r-sm)",
            color: "var(--ft-muted)",
            cursor: "pointer",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {TOGGLES.map((opt) => (
        <label
          key={opt.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "4px 0",
            fontSize: 13,
            color: "var(--ft-text)",
            opacity: value[opt.key] ? 1 : 0.55,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={value[opt.key]}
            onChange={(e) => onChange({ [opt.key]: e.target.checked } as Partial<LayerState>)}
            style={{ cursor: "pointer", accentColor: "var(--ft-accent)", width: 15, height: 15, flexShrink: 0 }}
          />
          <span style={{ whiteSpace: "nowrap" }}>{opt.label}</span>
          {opt.note && (
            <span style={{ fontSize: 9, color: "var(--ft-muted)" }}>{opt.note}</span>
          )}
        </label>
      ))}
    </div>
    </>
  );
}
