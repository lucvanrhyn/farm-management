"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { SpeciesId } from "./species/types";

// ============================================================
// Types
// ============================================================

export type FarmMode = SpeciesId; // "cattle" | "sheep" | "game"

interface FarmModeContextValue {
  /** Currently active farm mode */
  readonly mode: FarmMode;
  /** Set the active farm mode (persists to localStorage) */
  readonly setMode: (mode: FarmMode) => void;
  /** Species enabled for this farm (from FarmSpeciesSettings) */
  readonly enabledModes: readonly FarmMode[];
  /** Whether the farm has more than one species enabled */
  readonly isMultiMode: boolean;
}

const FarmModeContext = createContext<FarmModeContextValue | null>(null);

// ============================================================
// localStorage helpers
// ============================================================

const STORAGE_KEY_PREFIX = "farmtrack-mode-";

function getStoredMode(farmSlug: string): FarmMode | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${farmSlug}`);
    if (stored === "cattle" || stored === "sheep" || stored === "game") {
      return stored;
    }
  } catch {
    // localStorage unavailable (SSR, privacy mode, etc.)
  }
  return null;
}

function setStoredMode(farmSlug: string, mode: FarmMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${farmSlug}`, mode);
    // Also persist to a cookie so server components can read the mode.
    document.cookie = `${STORAGE_KEY_PREFIX}${farmSlug}=${mode};path=/;max-age=31536000;SameSite=Lax`;
  } catch {
    // Non-fatal
  }
}

// ============================================================
// Provider
// ============================================================

interface FarmModeProviderProps {
  readonly farmSlug: string;
  /** Enabled species from server (FarmSpeciesSettings). Cattle is always included. */
  readonly enabledSpecies: readonly string[];
  readonly children: ReactNode;
}

export function FarmModeProvider({
  farmSlug,
  enabledSpecies,
  children,
}: FarmModeProviderProps) {
  // Memoize to avoid re-creating on every render
  const enabledModes = useMemo<FarmMode[]>(() => {
    const valid = enabledSpecies.filter(
      (s): s is FarmMode => s === "cattle" || s === "sheep" || s === "game",
    );
    return valid.includes("cattle") ? valid : ["cattle", ...valid];
  }, [enabledSpecies]);

  // Lazy initializer reads localStorage on first client render (SSR-safe —
  // getStoredMode returns null on the server). Eliminates the synchronous
  // setState-in-effect that the lint rule flags.
  const [rawMode, setModeState] = useState<FarmMode>(() => {
    const stored = getStoredMode(farmSlug);
    return stored && enabledModes.includes(stored) ? stored : enabledModes[0];
  });

  // Track the farmSlug this provider's `rawMode` was last seeded for. When
  // Next App Router navigates to a different farm the params change but the
  // client provider stays mounted (it lives above the [farmSlug] layout
  // boundary). Without this re-seed, `rawMode` would still reflect the
  // PREVIOUS farm's choice and the cookie-write effect below would overwrite
  // the new farm's stored mode — leaking species filtering across tenants
  // (the original Bug 3 species-leak).
  //
  // The React-blessed "adjusting state on prop change" pattern stores the
  // previous prop in `useState` and compares during render
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  // Reading state during render is fine; the React-Compiler ESLint rule that
  // forbids ref mutation during render does NOT flag this approach.
  const [lastFarmSlug, setLastFarmSlug] = useState(farmSlug);
  if (lastFarmSlug !== farmSlug) {
    const stored = getStoredMode(farmSlug);
    const next =
      stored && enabledModes.includes(stored) ? stored : enabledModes[0];
    setLastFarmSlug(farmSlug);
    setModeState(next);
  }

  // Clamp mode in render if enabledModes changed and the stored choice is now
  // invalid — purely derived, no effect needed.
  const mode: FarmMode = enabledModes.includes(rawMode) ? rawMode : enabledModes[0];

  // Sync cookie on mount and whenever farmSlug/mode changes. No setState here.
  // The dependency on `lastFarmSlug` (which is updated synchronously alongside
  // setModeState above) guarantees the effect only fires after the re-seed
  // commit, never on the discarded render where `mode` would still be the
  // pre-reset value.
  useEffect(() => {
    if (lastFarmSlug !== farmSlug) return;
    setStoredMode(farmSlug, mode);
  }, [farmSlug, mode, lastFarmSlug]);

  // Persist mode changes to localStorage
  const setMode = useCallback(
    (newMode: FarmMode) => {
      if (!enabledModes.includes(newMode)) return;
      setModeState(newMode);
      setStoredMode(farmSlug, newMode);
    },
    [farmSlug, enabledModes],
  );

  const value: FarmModeContextValue = {
    mode,
    setMode,
    enabledModes,
    isMultiMode: enabledModes.length > 1,
  };

  return (
    <FarmModeContext.Provider value={value}>{children}</FarmModeContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================

export function useFarmMode(): FarmModeContextValue {
  const ctx = useContext(FarmModeContext);
  if (!ctx) {
    throw new Error("useFarmMode must be used within a FarmModeProvider");
  }
  return ctx;
}

/**
 * Safe version that returns a default when used outside provider.
 * Useful in shared components that may render before provider mounts.
 */
export function useFarmModeSafe(): FarmModeContextValue {
  const ctx = useContext(FarmModeContext);
  if (!ctx) {
    return {
      mode: "cattle",
      setMode: () => {},
      enabledModes: ["cattle"],
      isMultiMode: false,
    };
  }
  return ctx;
}
