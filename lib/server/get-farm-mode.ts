// lib/server/get-farm-mode.ts
// Reads the farm mode (species) for the current request from a cookie.
// The cookie is set client-side by FarmModeProvider (lib/farm-mode.tsx)
// whenever the user switches modes, enabling server components to filter by species.

import { cookies } from "next/headers";
import type { FarmMode } from "@/lib/farm-mode";
import { getCachedFarmSpeciesSettings } from "@/lib/server/cached";

const VALID_MODES: FarmMode[] = ["cattle", "sheep", "game"];

function isFarmMode(value: string): value is FarmMode {
  return VALID_MODES.includes(value as FarmMode);
}

/**
 * Returns the active farm mode for a given farm.
 *
 * Resolution order (S7 / sp-L1, stress-test remediation 2026-06-01):
 *   1. A valid `farmtrack-mode-<slug>` cookie always wins.
 *   2. No (or invalid) cookie — fresh login, new device, cleared cookies —
 *      falls back to the FIRST valid species in the farm's enabled-species
 *      settings. This is the same source `FarmModeProvider` seeds
 *      `enabledModes` from (its own default is `enabledModes[0]`), so the
 *      server-side and client-side defaults move together by construction
 *      instead of the server hardcoding "cattle" on sheep/game farms.
 *   3. If the settings read fails or yields nothing usable, fail open to
 *      "cattle" — mirrors the documented fail-open in
 *      app/[farmSlug]/layout.tsx (species settings being unavailable must
 *      not take down server rendering).
 */
export async function getFarmMode(farmSlug: string): Promise<FarmMode> {
  const cookieStore = await cookies();
  const value = cookieStore.get(`farmtrack-mode-${farmSlug}`)?.value;
  if (value && isFarmMode(value)) {
    return value;
  }
  try {
    const { enabledSpecies } = await getCachedFarmSpeciesSettings(farmSlug);
    const firstValid = enabledSpecies.find(isFarmMode);
    if (firstValid) {
      return firstValid;
    }
  } catch {
    // Fail open below. Intentionally swallowed: this is the read path for
    // every server component / API route on the farm; a tenant-DB blip here
    // must degrade to the legacy default, not 500 the page.
  }
  return "cattle";
}
