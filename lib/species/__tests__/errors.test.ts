import { describe, expect, it } from "vitest";

import {
  CROSS_SPECIES_BLOCKED,
  CrossSpeciesBlockedError,
} from "@/lib/species/errors";

describe("CrossSpeciesBlockedError", () => {
  it("exposes the wire code constant", () => {
    expect(CROSS_SPECIES_BLOCKED).toBe("CROSS_SPECIES_BLOCKED");
  });

  it("carries the typed shape the api-errors map relies on", () => {
    const err = new CrossSpeciesBlockedError("cattle", "sheep");

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CrossSpeciesBlockedError");
    expect(err.code).toBe("CROSS_SPECIES_BLOCKED");
    expect(err.message).toBe("CROSS_SPECIES_BLOCKED");
    expect(err.mobSpecies).toBe("cattle");
    expect(err.campSpecies).toBe("sheep");
  });

  it("accepts null species (mob-side cross-species attempt)", () => {
    const err = new CrossSpeciesBlockedError("cattle", null);

    expect(err.mobSpecies).toBe("cattle");
    expect(err.campSpecies).toBeNull();
  });
});
