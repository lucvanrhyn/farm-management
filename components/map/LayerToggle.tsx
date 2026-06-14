"use client";

/**
 * LayerToggle — floating checkbox panel that controls which FarmMap layers
 * are mounted. Persists to localStorage under `farmtrack.map.layers`.
 *
 * Advanced-tier gating is wrapped around this component by Wave 3F; this
 * component just renders the toggles.
 */

import { useState, useCallback } from "react";

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
 * Mobile re-anchor (issue #468). On desktop the Layers panel sits bottom-right
 * and the action cluster sits bottom-left — they clear each other with room to
 * spare. At narrow widths the two overlays meet in the middle of the bottom
 * band and the panel paints over the *Draw Camp Boundary* button.
 *
 * The fix is purely spatial and font-independent: below 640px the panel docks
 * to the TOP-right (under the Mapbox nav controls) instead of the bottom-right,
 * which removes any vertical overlap with the bottom-left action cluster. The
 * `!important` is required to beat the component's inline `bottom`/`right`.
 * CSS-only ⇒ SSR-safe (no hydration branch) and the desktop layout is byte-for-
 * byte unchanged (the rule never matches above 640px).
 */
const MOBILE_REANCHOR_CSS = `
@media (max-width: 640px) {
  .ft-map-layer-toggle {
    bottom: auto !important;
    top: 96px !important;
    max-height: calc(100% - 132px);
    overflow-y: auto;
  }
}
`;

export default function LayerToggle({ value, onChange }: Props) {
  return (
    <>
    <style>{MOBILE_REANCHOR_CSS}</style>
    <div
      data-testid="map-layer-toggle"
      className="ft-map-layer-toggle"
      style={{
        position: "absolute",
        bottom: 24,
        right: 16,
        zIndex: 11,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "14px 16px",
        borderRadius: 14,
        // Dark-glass card — floats over the satellite map, outside any
        // .dark-surface scope, so it carries literal glass values.
        background: "rgba(26,21,16,0.92)",
        backdropFilter: "blur(14px) saturate(140%)",
        border: "1px solid rgba(255,235,210,0.13)",
        boxShadow: "0 10px 36px -12px rgba(0,0,0,0.6)",
        color: "#EFE7D8",
        minWidth: 208,
      }}
    >
      <div
        className="ft-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "rgba(255,235,210,0.6)",
          marginBottom: 8,
        }}
      >
        Layers
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
            color: "#EFE7D8",
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
            <span style={{ fontSize: 9, color: "rgba(255,235,210,0.5)" }}>{opt.note}</span>
          )}
        </label>
      ))}
    </div>
    </>
  );
}
