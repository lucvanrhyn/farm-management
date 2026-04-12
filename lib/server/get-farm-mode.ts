// lib/server/get-farm-mode.ts
// Reads the farm mode (species) for the current request from a cookie.
// The cookie is set client-side by FarmModeProvider (lib/farm-mode.tsx)
// whenever the user switches modes, enabling server components to filter by species.

import { cookies } from "next/headers";
import type { FarmMode } from "@/lib/farm-mode";

const VALID_MODES: FarmMode[] = ["cattle", "sheep", "game"];

/**
 * Returns the active farm mode for a given farm, read from the request cookie.
 * Falls back to "cattle" when no cookie is present.
 */
export async function getFarmMode(farmSlug: string): Promise<FarmMode> {
  const cookieStore = await cookies();
  const value = cookieStore.get(`farmtrack-mode-${farmSlug}`)?.value;
  if (value && VALID_MODES.includes(value as FarmMode)) {
    return value as FarmMode;
  }
  return "cattle";
}
