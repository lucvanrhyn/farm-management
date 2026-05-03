import { NextResponse } from "next/server";
import { CrossSpeciesBlockedError, MobNotFoundError } from "@/lib/server/mob-move";

/**
 * Maps a thrown domain error onto the canonical HTTP response for that
 * error class. Returns `null` if the error is unknown — callers should
 * rethrow so Next.js' default 500 handler kicks in.
 *
 * Example:
 *   try { await performMobMove(...); }
 *   catch (err) {
 *     const mapped = mapApiDomainError(err);
 *     if (mapped) return mapped;
 *     throw err;
 *   }
 *
 * Status/body contract is the live one used by `app/api/mobs/[mobId]`
 * (404 "Mob not found") and `app/api/animals/[id]` (422
 * "CROSS_SPECIES_BLOCKED"); changing it is an API break.
 */
export function mapApiDomainError(err: unknown): NextResponse | null {
  if (err instanceof MobNotFoundError) {
    return NextResponse.json({ error: "Mob not found" }, { status: 404 });
  }
  if (err instanceof CrossSpeciesBlockedError) {
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  return null;
}
