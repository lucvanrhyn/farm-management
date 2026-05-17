/**
 * Wave 309a (ADR-0001 Wave B, #309) — domain-layer typed errors for
 * `lib/domain/camps/*`.
 *
 * Camps reuses the canonical `CampNotFoundError` (wire `CAMP_NOT_FOUND`
 * 404, owned by `lib/domain/observations/errors.ts` — generic + reusable)
 * for the not-found case; nothing depends on the pre-extraction free-text
 * `{ error: "Camp not found" }` body for `app/api/camps/[campId]`, so the
 * canonical-code direction (ADR-0001 / Wave C) applies.
 *
 * The only genuinely new failure mode is the delete-time active-animal
 * guard, modelled here mirroring `MobHasAnimalsError`: the count-bearing
 * message is preserved on the wire (legacy clients render the `error`
 * field as a sentence — not yet migrated to a typed code).
 *
 * Wave 316a (#309) appends the two POST /api/camps create-time failure
 * modes: `MissingSpeciesError` (typed 422 `MISSING_SPECIES` per #232) and
 * `DuplicateCampError` (409, message-preserving like
 * `CampHasActiveAnimalsError` — the legacy admin form pattern-matches the
 * free-text string).
 */

export const CAMP_HAS_ACTIVE_ANIMALS = "CAMP_HAS_ACTIVE_ANIMALS" as const;

/**
 * Delete attempted on a camp that still has active animals referencing it
 * (cross-species: the guard counts on `currentCamp` for every species).
 * Wire: 409 `{ error: "Cannot delete camp with <n> active animal(s)..." }`
 * — the message is preserved on the wire because legacy clients display
 * it directly. Byte-identical to the pre-extraction route literal.
 */
export class CampHasActiveAnimalsError extends Error {
  readonly code = CAMP_HAS_ACTIVE_ANIMALS;
  readonly activeCount: number;
  constructor(activeCount: number) {
    super(
      `Cannot delete camp with ${activeCount} active animal(s). Move or remove them first.`,
    );
    this.name = "CampHasActiveAnimalsError";
    this.activeCount = activeCount;
  }
}

export const MISSING_SPECIES = "MISSING_SPECIES" as const;

/**
 * Create attempted without choosing a species (issue #232). Distinct from
 * schema VALIDATION_FAILED (400 with `details.fieldErrors.species`): this
 * is a typed 422 `{ error: "MISSING_SPECIES" }` so clients can render a
 * "please pick a species" UX without parsing the field-errors bag. The
 * wire body is the bare code (no inherited Prisma column default).
 */
export class MissingSpeciesError extends Error {
  readonly code = MISSING_SPECIES;
  constructor() {
    super(MISSING_SPECIES);
    this.name = "MissingSpeciesError";
  }
}

export const DUPLICATE_CAMP = "DUPLICATE_CAMP" as const;

/**
 * Create attempted with a (species, campId) pair that already exists
 * (Phase A of #28: campId is no longer globally unique — the duplicate
 * guard is species-scoped). Wire: 409 `{ error: "A camp with this ID
 * already exists" }` — the message is preserved on the wire because the
 * legacy admin form pattern-matches it directly. Byte-identical to the
 * pre-extraction route literal.
 */
export class DuplicateCampError extends Error {
  readonly code = DUPLICATE_CAMP;
  constructor() {
    super("A camp with this ID already exists");
    this.name = "DuplicateCampError";
  }
}
