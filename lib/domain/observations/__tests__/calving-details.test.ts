/**
 * lib/domain/observations/__tests__/calving-details.test.ts
 *
 * Locks the SINGLE definition of a birth observation's outcome. Births are
 * persisted under TWO key conventions:
 *   - dedicated Calving/Lambing tile → { calfAlive: boolean, calfAnimalId, birthWeight, calvingDifficulty }
 *   - ReproductionForm calving sub-flow → { calf_status: "live"|..., calf_tag }
 * A reader knowing only `calf_status` silently drops every tile-logged birth
 * (the primary path) from calving/birth/weaning rates. This is the regression
 * lock for that bug class.
 */
import { describe, it, expect } from "vitest";
import {
  isLiveBirth,
  offspringTag,
  birthWeightKg,
  calvingDifficulty,
} from "@/lib/domain/observations/calving-details";

describe("isLiveBirth — dual-convention live-birth flag", () => {
  it("reads the dedicated tile's boolean calfAlive=true", () => {
    expect(isLiveBirth({ calfAlive: true, calfAnimalId: "C1" })).toBe(true);
  });

  it("reads the dedicated tile's boolean calfAlive=false (stillbirth)", () => {
    expect(isLiveBirth({ calfAlive: false, calfAnimalId: "C1" })).toBe(false);
  });

  it("reads the ReproductionForm calf_status string", () => {
    expect(isLiveBirth({ calf_status: "live", calf_tag: "C1" })).toBe(true);
    expect(isLiveBirth({ calf_status: "stillborn" })).toBe(false);
  });

  it("reads game/sheep offspring_status fallbacks", () => {
    expect(isLiveBirth({ offspring_status: "live" })).toBe(true);
    expect(isLiveBirth({ lamb_status: "live" })).toBe(true);
    expect(isLiveBirth({ fawn_status: "live" })).toBe(true);
  });

  it("treats a record with neither key as not-live (unchanged legacy semantics)", () => {
    expect(isLiveBirth({})).toBe(false);
    expect(isLiveBirth(null)).toBe(false);
    expect(isLiveBirth(undefined)).toBe(false);
  });

  it("prefers the explicit boolean over any status string", () => {
    // A tile stillbirth must not be rescued by a stray status string.
    expect(isLiveBirth({ calfAlive: false, calf_status: "live" })).toBe(false);
  });
});

describe("offspringTag — calf/lamb/fawn ear tag", () => {
  it("reads the dedicated tile's calfAnimalId", () => {
    expect(offspringTag({ calfAnimalId: "TB-2026-001" })).toBe("TB-2026-001");
  });
  it("falls back to snake_case *_tag forms", () => {
    expect(offspringTag({ calf_tag: "C9" })).toBe("C9");
    expect(offspringTag({ lamb_tag: "L9" })).toBe("L9");
    expect(offspringTag({ fawn_tag: "F9" })).toBe("F9");
  });
  it("returns null when absent", () => {
    expect(offspringTag({})).toBeNull();
  });
});

describe("birthWeightKg / calvingDifficulty — dual-key numeric reads", () => {
  it("reads the tile's camelCase keys", () => {
    expect(birthWeightKg({ birthWeight: 38 })).toBe(38);
    expect(calvingDifficulty({ calvingDifficulty: 2 })).toBe(2);
  });
  it("reads legacy snake_case keys (numeric or numeric-string)", () => {
    expect(birthWeightKg({ birth_weight: "40" })).toBe(40);
    expect(calvingDifficulty({ calving_difficulty: "3" })).toBe(3);
  });
  it("returns null for missing / non-numeric", () => {
    expect(birthWeightKg({})).toBeNull();
    expect(calvingDifficulty({ calving_difficulty: "n/a" })).toBeNull();
  });
});
