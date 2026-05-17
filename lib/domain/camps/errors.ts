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
