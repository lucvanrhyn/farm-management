/**
 * lib/server/species-modules.ts — the shared per-species module registry +
 * farm-gated resolver.
 *
 * Extracted from `dashboard-alerts.ts` so that EVERY per-species fan-out
 * (dashboard alerts AND Herd Triage) gates on the SAME enabled set. Centralising
 * it is the structural guard for #203 (sheep alerts leaking onto cattle-only
 * farms) and #356 (never cattle-hard-scope a per-species surface): a new
 * per-species feature calls `getEnabledSpeciesModules` instead of re-deriving
 * the gate and risking a drift.
 */

import type { PrismaClient } from "@prisma/client";
import { cattleModule } from "@/lib/species/cattle";
import { sheepModule } from "@/lib/species/sheep";
import { gameModule } from "@/lib/species/game";
import type { SpeciesModule, SpeciesId } from "@/lib/species/types";

/**
 * Registry of all species modules, keyed by id. The set actually queried on
 * each request is filtered by the farm's FarmSpeciesSettings (see
 * `getEnabledSpeciesModules`). Cattle is always included as a safe default.
 */
export const ALL_SPECIES_MODULES: Record<SpeciesId, SpeciesModule> = {
  cattle: cattleModule,
  sheep: sheepModule,
  game: gameModule,
};

/**
 * Resolve the species modules to query for this farm. Reads FarmSpeciesSettings
 * via the request-scoped Prisma client and filters `ALL_SPECIES_MODULES` to the
 * enabled set. Cattle is always included (safe default — every farm has cattle
 * in our current data model, and the cached species-settings helper applies the
 * same fallback). On lookup failure we degrade to cattle-only so a transient DB
 * blip can't unintentionally surface alerts for species the farm doesn't run.
 */
export async function getEnabledSpeciesModules(
  prisma: PrismaClient,
): Promise<SpeciesModule[]> {
  try {
    const rows = await prisma.farmSpeciesSettings.findMany({
      select: { species: true, enabled: true },
      take: 50,
    });
    const enabled = new Set<string>(
      rows.filter((r) => r.enabled).map((r) => r.species),
    );
    enabled.add("cattle");
    return (Object.keys(ALL_SPECIES_MODULES) as SpeciesId[])
      .filter((id) => enabled.has(id))
      .map((id) => ALL_SPECIES_MODULES[id]);
  } catch {
    return [ALL_SPECIES_MODULES.cattle];
  }
}
