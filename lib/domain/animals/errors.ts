/**
 * Wave 309b (ADR-0001 Wave B, #309) — domain-layer typed errors for
 * `lib/domain/animals/*` (the `[id]` GET + PATCH ops).
 *
 * Unlike the camps/observations slices, this route carries
 * **authorization + validation** and the wave is strictly behaviour-
 * preserving: every error class here pins the *exact* pre-extraction
 * wire literal — NOT the canonical SCREAMING_SNAKE direction. The
 * `mapApiDomainError` arms reproduce the legacy status + body
 * byte-identical:
 *
 *   - `AnimalNotFoundError`       → 404 `{ error: "Not found" }`
 *   - `AnimalFieldForbiddenError` → 403 `{ error: "FORBIDDEN",
 *                                          message: "Forbidden" }`
 *                                   (the exact `routeError("FORBIDDEN",
 *                                    "Forbidden", 403)` envelope shape)
 *   - `InvalidAnimalFieldError`   → 400 `{ error: <message> }`
 *                                   (the legacy free-text enum message)
 *   - `ParentNotFoundError`       → 422 `{ error: "PARENT_NOT_FOUND" }`
 *   - `SpeciesScopedCampError`    → 422 `{ error: reason }`
 *                                   (reason ∈ NOT_FOUND | WRONG_SPECIES)
 *
 * The cross-species *parent* mismatch reuses `CrossSpeciesBlockedError`,
 * centralised in `@/lib/species/errors` (#315) and already mapped to 422
 * `{ error: "CROSS_SPECIES_BLOCKED" }`. The op imports it from there.
 */

/**
 * GET `/api/animals/[id]` for a non-existent animalId. The legacy route
 * returned `NextResponse.json({ error: "Not found" }, { status: 404 })`
 * — preserved byte-identical (no test/client proves the canonical
 * direction for this route).
 */
export class AnimalNotFoundError extends Error {
  readonly animalId: string;
  constructor(animalId: string) {
    super("Not found");
    this.name = "AnimalNotFoundError";
    this.animalId = animalId;
  }
}

/**
 * The caller's role is not permitted to write the requested field set:
 * a LOGGER touching a key outside `{status, deceasedAt, currentCamp}`,
 * or any non-ADMIN non-LOGGER role. The legacy route minted this via
 * `routeError("FORBIDDEN", "Forbidden", 403)` → body
 * `{ error: "FORBIDDEN", message: "Forbidden" }` at status 403. The
 * `mapApiDomainError` arm reproduces that envelope byte-identical.
 */
export class AnimalFieldForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "AnimalFieldForbiddenError";
  }
}

/**
 * An enum field failed validation. `message` is the legacy free-text
 * sentence (`"status must be one of: Active, Deceased, Sold, Culled"` /
 * `"sex must be one of: Male, Female, Unknown"`) which is rendered on
 * the wire verbatim at 400 (`{ error: <message> }`).
 */
export class InvalidAnimalFieldError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "InvalidAnimalFieldError";
    this.field = field;
  }
}

export const PARENT_NOT_FOUND = "PARENT_NOT_FOUND" as const;

/**
 * A patched `motherId`/`fatherId` resolves to no animal in the tenant.
 * Legacy wire: 422 `{ error: "PARENT_NOT_FOUND" }` — the literal IS the
 * pre-extraction body string (NOT a canonical adoption).
 */
export class ParentNotFoundError extends Error {
  readonly code = PARENT_NOT_FOUND;
  constructor() {
    super(PARENT_NOT_FOUND);
    this.name = "ParentNotFoundError";
  }
}

/**
 * The #98 cross-species camp guard rejected a `currentCamp` move. The
 * reason flows straight from `requireSpeciesScopedCamp`'s discriminated
 * union (`NOT_FOUND` | `WRONG_SPECIES`). Legacy wire: 422
 * `{ error: result.reason }` — preserved byte-identical.
 */
export class SpeciesScopedCampError extends Error {
  readonly reason: "NOT_FOUND" | "WRONG_SPECIES";
  constructor(reason: "NOT_FOUND" | "WRONG_SPECIES") {
    super(reason);
    this.name = "SpeciesScopedCampError";
    this.reason = reason;
  }
}
