/**
 * @vitest-environment node
 *
 * Wave 309b (ADR-0001 Wave B, #309) — typed errors for
 * `lib/domain/animals/*`.
 *
 * This route carries authorization + validation and the wave is
 * behaviour-preserving: every error class below pins the *exact* legacy
 * wire literal (NOT the canonical SCREAMING_SNAKE direction). The
 * `mapApiDomainError` arms reproduce the pre-extraction status + body
 * byte-identical:
 *
 *   - AnimalNotFoundError       → 404 `{ error: "Not found" }`
 *   - AnimalFieldForbiddenError → 403 `{ error: "FORBIDDEN",
 *                                          message: "Forbidden" }`
 *                                 (the `routeError("FORBIDDEN",
 *                                  "Forbidden", 403)` envelope)
 *   - InvalidAnimalFieldError   → 400 `{ error: <message> }`
 *   - ParentNotFoundError       → 422 `{ error: "PARENT_NOT_FOUND" }`
 *   - SpeciesScopedCampError    → 422 `{ error: "NOT_FOUND" | "WRONG_SPECIES" }`
 *
 * Cross-species parent mismatch reuses `CrossSpeciesBlockedError` from
 * `@/lib/species/errors` (#315) (already mapped — NOT re-declared here).
 */
import { describe, it, expect } from "vitest";

import {
  AnimalNotFoundError,
  AnimalFieldForbiddenError,
  InvalidAnimalFieldError,
  ParentNotFoundError,
  SpeciesScopedCampError,
  PARENT_NOT_FOUND,
} from "../errors";

describe("AnimalNotFoundError", () => {
  it("is an Error subclass with a stable name", () => {
    const err = new AnimalNotFoundError("A-1");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AnimalNotFoundError");
  });

  it("carries the animalId for diagnostics", () => {
    const err = new AnimalNotFoundError("A-1");
    expect(err.animalId).toBe("A-1");
  });
});

describe("AnimalFieldForbiddenError", () => {
  it("is an Error subclass with a stable name", () => {
    const err = new AnimalFieldForbiddenError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AnimalFieldForbiddenError");
  });
});

describe("InvalidAnimalFieldError", () => {
  it("preserves the legacy free-text validation message verbatim", () => {
    const err = new InvalidAnimalFieldError(
      "status",
      "status must be one of: Active, Deceased, Sold, Culled",
    );
    expect(err.field).toBe("status");
    expect(err.message).toBe(
      "status must be one of: Active, Deceased, Sold, Culled",
    );
  });

  it("is an Error subclass with a stable name", () => {
    const err = new InvalidAnimalFieldError("sex", "x");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvalidAnimalFieldError");
  });
});

describe("ParentNotFoundError", () => {
  it("exposes the legacy wire literal (NOT canonical)", () => {
    const err = new ParentNotFoundError();
    expect(err.code).toBe(PARENT_NOT_FOUND);
    expect(PARENT_NOT_FOUND).toBe("PARENT_NOT_FOUND");
  });

  it("is an Error subclass with a stable name", () => {
    const err = new ParentNotFoundError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ParentNotFoundError");
  });
});

describe("SpeciesScopedCampError", () => {
  it("carries the reason verbatim (NOT_FOUND)", () => {
    const err = new SpeciesScopedCampError("NOT_FOUND");
    expect(err.reason).toBe("NOT_FOUND");
  });

  it("carries the reason verbatim (WRONG_SPECIES)", () => {
    const err = new SpeciesScopedCampError("WRONG_SPECIES");
    expect(err.reason).toBe("WRONG_SPECIES");
  });

  it("is an Error subclass with a stable name", () => {
    const err = new SpeciesScopedCampError("NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SpeciesScopedCampError");
  });
});
