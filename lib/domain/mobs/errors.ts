/**
 * Wave B (#151) — domain-layer typed errors for `lib/domain/mobs/*`.
 *
 * Each error wraps a SCREAMING_SNAKE wire code. The `mapApiDomainError`
 * helper at `lib/server/api-errors.ts` maps these onto the existing
 * pre-Wave-B HTTP responses so the wire shape stays backward compatible
 * with the typed-error consumers (`{ error: CODE }` at the documented
 * status code).
 */

export const WRONG_SPECIES = "WRONG_SPECIES" as const;
export const NOT_FOUND = "NOT_FOUND" as const;
export const MOB_HAS_ANIMALS = "MOB_HAS_ANIMALS" as const;

/**
 * The destination camp exists but belongs to a different species (or is
 * legacy data with `species = null` — treated as "different species" per
 * the multi-species spec). Wire: 422 `{ error: "WRONG_SPECIES" }`.
 */
export class WrongSpeciesError extends Error {
  readonly code = WRONG_SPECIES;
  constructor() {
    super(WRONG_SPECIES);
    this.name = "WrongSpeciesError";
  }
}

/**
 * No camp with the given campId exists in the tenant at all (orphan move
 * attempt). Wire: 422 `{ error: "NOT_FOUND" }` for create-mob; the
 * `[mobId]` lookup variant uses `MobNotFoundError` (wire 404).
 */
export class NotFoundError extends Error {
  readonly code = NOT_FOUND;
  constructor() {
    super(NOT_FOUND);
    this.name = "NotFoundError";
  }
}

/**
 * Delete attempted on a mob that still has active animals attached.
 * Wire: 409 `{ error: "<count> assigned animal(s)" }` — the message is
 * preserved on the wire because legacy clients display it directly.
 */
export class MobHasAnimalsError extends Error {
  readonly code = MOB_HAS_ANIMALS;
  readonly assignedCount: number;
  constructor(assignedCount: number) {
    super(
      `Cannot delete mob with ${assignedCount} assigned animal(s). Remove them first.`,
    );
    this.name = "MobHasAnimalsError";
    this.assignedCount = assignedCount;
  }
}
