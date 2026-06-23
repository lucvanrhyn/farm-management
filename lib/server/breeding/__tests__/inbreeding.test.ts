/**
 * lib/server/breeding/__tests__/inbreeding.test.ts
 *
 * Regression lock for the cuid/tag pedigree-join bug on the inbreeding engine.
 *
 * Animal.motherId / Animal.fatherId store the parent's TAG (Animal.animalId),
 * not the cuid Animal.id. calculateCOI keyed its pedigree map by the cuid and
 * recursed using parent TAGs → every lookup past the immediate parents missed →
 * COI collapsed to ~0 and genuinely inbred matings scored "safe". detectInbreedingRisk
 * compared `a.motherId === b.id` (tag === cuid) so parent_offspring never fired.
 */
import { describe, it, expect } from "vitest";
import { calculateCOI, detectInbreedingRisk } from "@/lib/server/breeding/inbreeding";
import type { AnimalRow } from "@/lib/server/breeding/types";

function animal(tag: string, motherId: string | null, fatherId: string | null): AnimalRow {
  return {
    id: `cuid-${tag}`, // cuid — deliberately different from the tag
    animalId: tag,
    sex: "Female",
    category: "Cow",
    status: "Active",
    motherId,
    fatherId,
  };
}

describe("calculateCOI — pedigree traversal joins on the TAG", () => {
  it("detects a shared grandsire (COI > 0); cuid-keyed traversal returned 0", () => {
    // Shared grandsire GS-1 two generations up on both sides.
    const gs = animal("GS-1", null, null);
    const sire = animal("S-1", null, "GS-1"); // bull's father, son of GS-1
    const dam = animal("D-1", null, "GS-1"); // cow's father, son of GS-1
    const bull = animal("BULL-1", null, "S-1");
    const cow = animal("COW-1", null, "D-1");
    const all = [gs, sire, dam, bull, cow];

    const coi = calculateCOI(bull, cow, all);
    // Two 2-step paths to GS-1: (1/2)^(3+3-1) = (1/2)^5 = 0.03125.
    expect(coi).toBeCloseTo(0.03125, 6);
    expect(coi).toBeGreaterThan(0);
  });

  it("full siblings (shared dam+sire tags) yield a high COI", () => {
    const dam = animal("DAM-1", null, null);
    const sire = animal("SIRE-1", null, null);
    const a = animal("A", "DAM-1", "SIRE-1");
    const b = animal("B", "DAM-1", "SIRE-1");
    const coi = calculateCOI(a, b, [dam, sire, a, b]);
    expect(coi).toBeGreaterThan(0);
  });
});

describe("detectInbreedingRisk — parent links compared on the TAG", () => {
  it("flags a parent_offspring pair (tag===cuid comparison never matched pre-fix)", () => {
    const dam = animal("DAM-1", null, null);
    const calf = animal("CALF-1", "DAM-1", null); // motherId = dam's TAG
    const risks = detectInbreedingRisk([dam, calf]);
    expect(risks.some((r) => r.riskType === "parent_offspring")).toBe(true);
  });

  it("flags shared_grandparent via tag-keyed lookup", () => {
    const gs = animal("GS-1", null, null);
    const sire = animal("S-1", null, "GS-1");
    const dam = animal("D-1", null, "GS-1");
    const a = animal("A", null, "S-1");
    const b = animal("B", null, "D-1");
    const risks = detectInbreedingRisk([gs, sire, dam, a, b]);
    expect(risks.some((r) => r.riskType === "shared_grandparent")).toBe(true);
  });
});
