import { NextResponse } from "next/server";
import { CrossSpeciesBlockedError, MobNotFoundError } from "@/lib/server/mob-move";
import {
  MobHasAnimalsError,
  NotFoundError,
  WrongSpeciesError,
} from "@/lib/domain/mobs/errors";

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
 *
 * Wave B (#151) extension — added `WrongSpeciesError` (422 WRONG_SPECIES),
 * `NotFoundError` (422 NOT_FOUND), `MobHasAnimalsError` (409 with the
 * count-bearing message). All three are emitted by the new `lib/domain/mobs/*`
 * ops. Wire shape stays bare `{ error: CODE }` so the pre-Wave-B tests
 * (which compared by strict equality) keep passing without modification.
 */
export function mapApiDomainError(err: unknown): NextResponse | null {
  if (err instanceof MobNotFoundError) {
    return NextResponse.json({ error: "Mob not found" }, { status: 404 });
  }
  if (err instanceof CrossSpeciesBlockedError) {
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  if (err instanceof WrongSpeciesError) {
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.code }, { status: 422 });
  }
  if (err instanceof MobHasAnimalsError) {
    // Wire shape preserves the count-bearing message (legacy clients display
    // the `error` field as a sentence — not yet migrated to a typed code).
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  return null;
}
