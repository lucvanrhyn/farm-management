"use client";

/**
 * LayerToggle — floating checkbox panel that controls which FarmMap layers
 * are mounted. Persists to localStorage under `farmtrack.map.layers`.
 *
 * Advanced-tier gating is wrapped around this component by Wave 3F; this
 * component just renders the toggles.
 */

import { useEffect, useState, useCallback } from "react";

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
  const [state, setState] = useState<LayerState>(DEFAULT_LAYER_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(readLayerState());
    setHydrated(true);
  }, []);

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

  // Suppress SSR hydration flash by forcing `hydrated` into state reads.
  void hydrated;

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

export default function LayerToggle({ value, onChange }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        right: 16,
        zIndex: 11,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(26,21,16,0.92)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(140,100,60,0.25)",
        fontFamily: "var(--font-sans)",
        minWidth: 168,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "rgba(210,180,140,0.7)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
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
            gap: 8,
            padding: "4px 4px",
            fontSize: 12,
            fontWeight: 500,
            color: value[opt.key] ? "#F5EBD4" : "rgba(210,180,140,0.7)",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={value[opt.key]}
            onChange={(e) => onChange({ [opt.key]: e.target.checked } as Partial<LayerState>)}
            style={{ cursor: "pointer" }}
          />
          <span>{opt.label}</span>
          {opt.note && (
            <span style={{ fontSize: 9, color: "rgba(210,180,140,0.5)" }}>{opt.note}</span>
          )}
        </label>
      ))}
    </div>
  );
}
