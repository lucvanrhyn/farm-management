/**
 * @vitest-environment node
 *
 * Wave 309a (ADR-0001 Wave B, #309) — typed errors for `lib/domain/camps/*`.
 *
 * `CampHasActiveAnimalsError` mirrors `MobHasAnimalsError`: it carries a
 * count and a count-bearing message that is preserved on the wire (legacy
 * clients display the `error` field as a sentence). The message MUST be
 * byte-identical to the pre-extraction route literal.
 */
import { describe, it, expect } from "vitest";

import { CampHasActiveAnimalsError, CAMP_HAS_ACTIVE_ANIMALS } from "../errors";

describe("CampHasActiveAnimalsError", () => {
  it("carries the active-animal count", () => {
    const err = new CampHasActiveAnimalsError(5);
    expect(err.activeCount).toBe(5);
  });

  it("exposes the SCREAMING_SNAKE wire code", () => {
    const err = new CampHasActiveAnimalsError(5);
    expect(err.code).toBe(CAMP_HAS_ACTIVE_ANIMALS);
    expect(CAMP_HAS_ACTIVE_ANIMALS).toBe("CAMP_HAS_ACTIVE_ANIMALS");
  });

  it("message is byte-identical to the legacy 409 string", () => {
    const err = new CampHasActiveAnimalsError(3);
    expect(err.message).toBe(
      "Cannot delete camp with 3 active animal(s). Move or remove them first.",
    );
  });

  it("is an Error subclass with a stable name", () => {
    const err = new CampHasActiveAnimalsError(1);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CampHasActiveAnimalsError");
  });
});
