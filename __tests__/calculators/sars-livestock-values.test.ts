/**
 * __tests__/calculators/sars-livestock-values.test.ts
 *
 * TDD tests for wave-26b: First Schedule paragraphs 5(1) + 6(1)(b)/(c)/(d) +
 * paragraph 7 election lock-in.
 *
 * Source pack:
 *   GN R105 (1965) as amended by GN R1814 (1976) — gazetted standard values.
 *   SARS Guide IT35 (13 Oct 2023), Annexure pp. 71-72 — verbatim reproduction.
 *
 * No fabricated values: every R-value asserted below is from the gazetted
 * source. The class-of-bug from wave/26 (fabricated 4101..4299 SARS codes) was
 * caused by skipping spec-validation; this test file is the spec gate for the
 * R-values.
 */

import { describe, it, expect } from "vitest";
import {
  STANDARD_VALUES,
  STANDARD_VALUES_GAZETTED_DATE,
  STANDARD_VALUES_SOURCE,
  lookupStandardValue,
  withinTwentyPercentBand,
  effectiveValue,
  UnknownLivestockClassError,
  ElectionExceedsTwentyPercentBandError,
  ElectionLockInError,
  type ElectionRecord,
  type LivestockClass,
} from "@/lib/calculators/sars-livestock-values";

// ── Source metadata ──────────────────────────────────────────────────────────

describe("STANDARD_VALUES metadata", () => {
  it("exposes the GN R1814 (1976) gazette date", () => {
    expect(STANDARD_VALUES_GAZETTED_DATE).toBe("1976-10-08");
  });

  it("cites both GN R105/R1814 and IT35 in the source string", () => {
    expect(STANDARD_VALUES_SOURCE).toContain("GN R105");
    expect(STANDARD_VALUES_SOURCE).toContain("GN R1814");
    expect(STANDARD_VALUES_SOURCE).toContain("IT35");
  });
});

// ── Cattle: bulls R50 / oxen R40 / cows R40 / 2-3yr R30 / 1-2yr R14 / calves R4 ─

describe("lookupStandardValue — cattle", () => {
  it("Bulls = R50", () => {
    expect(lookupStandardValue({ species: "cattle", ageCategory: "Bulls" })).toBe(50);
  });
  it("Oxen = R40", () => {
    expect(lookupStandardValue({ species: "cattle", ageCategory: "Oxen" })).toBe(40);
  });
  it("Cows = R40", () => {
    expect(lookupStandardValue({ species: "cattle", ageCategory: "Cows" })).toBe(40);
  });
  it("Tollies & heifers 2-3 years = R30", () => {
    expect(
      lookupStandardValue({ species: "cattle", ageCategory: "Tollies & heifers 2-3 years" }),
    ).toBe(30);
  });
  it("Tollies & heifers 1-2 years = R14", () => {
    expect(
      lookupStandardValue({ species: "cattle", ageCategory: "Tollies & heifers 1-2 years" }),
    ).toBe(14);
  });
  it("Calves = R4", () => {
    expect(lookupStandardValue({ species: "cattle", ageCategory: "Calves" })).toBe(4);
  });
});

// ── Sheep: rams R6 / ewes R6 / wethers R6 / weaned lambs R2 ───────────────────

describe("lookupStandardValue — sheep", () => {
  it("Rams = R6", () => {
    expect(lookupStandardValue({ species: "sheep", ageCategory: "Rams" })).toBe(6);
  });
  it("Ewes = R6", () => {
    expect(lookupStandardValue({ species: "sheep", ageCategory: "Ewes" })).toBe(6);
  });
  it("Wethers = R6", () => {
    expect(lookupStandardValue({ species: "sheep", ageCategory: "Wethers" })).toBe(6);
  });
  it("Weaned lambs = R2", () => {
    expect(lookupStandardValue({ species: "sheep", ageCategory: "Weaned lambs" })).toBe(2);
  });
});

// ── Goats: fully grown R4 / weaned kids R2 ────────────────────────────────────

describe("lookupStandardValue — goats", () => {
  it("Fully grown = R4", () => {
    expect(lookupStandardValue({ species: "goats", ageCategory: "Fully grown" })).toBe(4);
  });
  it("Weaned kids = R2", () => {
    expect(lookupStandardValue({ species: "goats", ageCategory: "Weaned kids" })).toBe(2);
  });
});

// ── Pigs: over 6 mo R12 / under 6 mo R6 ───────────────────────────────────────

describe("lookupStandardValue — pigs", () => {
  it("Over 6 months = R12", () => {
    expect(lookupStandardValue({ species: "pigs", ageCategory: "Over 6 months" })).toBe(12);
  });
  it("Under 6 months = R6", () => {
    expect(lookupStandardValue({ species: "pigs", ageCategory: "Under 6 months" })).toBe(6);
  });
});

// ── Horses: stallions 4+ R40 / mares 4+ R30 / geldings 3+ R30 / colts/fillies ──

describe("lookupStandardValue — horses", () => {
  it("Stallions over 4 years = R40", () => {
    expect(
      lookupStandardValue({ species: "horses", ageCategory: "Stallions over 4 years" }),
    ).toBe(40);
  });
  it("Mares over 4 years = R30", () => {
    expect(lookupStandardValue({ species: "horses", ageCategory: "Mares over 4 years" })).toBe(30);
  });
  it("Geldings over 3 years = R30", () => {
    expect(lookupStandardValue({ species: "horses", ageCategory: "Geldings over 3 years" })).toBe(30);
  });
  it("Colts/fillies 3 years = R10", () => {
    expect(lookupStandardValue({ species: "horses", ageCategory: "Colts/fillies 3 years" })).toBe(10);
  });
  it("Colts/fillies 2 years = R8", () => {
    expect(lookupStandardValue({ species: "horses", ageCategory: "Colts/fillies 2 years" })).toBe(8);
  });
  it("Colts/fillies 1 year = R6", () => {
    expect(lookupStandardValue({ species: "horses", ageCategory: "Colts/fillies 1 year" })).toBe(6);
  });
  it("Foals under 1 year = R2", () => {
    expect(lookupStandardValue({ species: "horses", ageCategory: "Foals under 1 year" })).toBe(2);
  });
});

// ── Donkeys / mules / ostriches / poultry / chinchillas ───────────────────────

describe("lookupStandardValue — minor species", () => {
  it("Donkeys jacks/jennies over 3 years = R4", () => {
    expect(
      lookupStandardValue({ species: "donkeys", ageCategory: "Jacks/jennies over 3 years" }),
    ).toBe(4);
  });
  it("Donkeys jacks/jennies under 3 years = R2", () => {
    expect(
      lookupStandardValue({ species: "donkeys", ageCategory: "Jacks/jennies under 3 years" }),
    ).toBe(2);
  });
  it("Mules 4+ years = R30", () => {
    expect(lookupStandardValue({ species: "mules", ageCategory: "4 years and over" })).toBe(30);
  });
  it("Mules 3 years = R20", () => {
    expect(lookupStandardValue({ species: "mules", ageCategory: "3 years" })).toBe(20);
  });
  it("Mules 2 years = R14", () => {
    expect(lookupStandardValue({ species: "mules", ageCategory: "2 years" })).toBe(14);
  });
  it("Mules 1 year = R6", () => {
    expect(lookupStandardValue({ species: "mules", ageCategory: "1 year" })).toBe(6);
  });
  it("Ostriches fully grown = R6", () => {
    expect(lookupStandardValue({ species: "ostriches", ageCategory: "Fully grown" })).toBe(6);
  });
  it("Poultry layers/breeders over 9 months = R1", () => {
    expect(
      lookupStandardValue({ species: "poultry", ageCategory: "Over 9 months" }),
    ).toBe(1);
  });
  it("Chinchillas all ages = R1", () => {
    expect(lookupStandardValue({ species: "chinchillas", ageCategory: "All ages" })).toBe(1);
  });
});

// ── Game: nil per IT35 §3.4.2 ─────────────────────────────────────────────────

describe("lookupStandardValue — game", () => {
  it("Game returns 0 (SARS-accepted nil; no gazetted standard value)", () => {
    expect(lookupStandardValue({ species: "game", ageCategory: "Adult Male" })).toBe(0);
    expect(lookupStandardValue({ species: "game", ageCategory: "Juvenile" })).toBe(0);
  });
});

// ── Unknown classes throw ─────────────────────────────────────────────────────

describe("lookupStandardValue — unknown classes throw", () => {
  it("throws UnknownLivestockClassError for unrecognised cattle category", () => {
    expect(() =>
      lookupStandardValue({ species: "cattle", ageCategory: "Wagyu Wagons" }),
    ).toThrow(UnknownLivestockClassError);
  });

  it("throws UnknownLivestockClassError for broilers (out of scope per research §D Q3)", () => {
    expect(() =>
      lookupStandardValue({ species: "poultry", ageCategory: "Broilers" }),
    ).toThrow(UnknownLivestockClassError);
  });

  it("throws UnknownLivestockClassError for completely unknown species", () => {
    expect(() =>
      // @ts-expect-error testing runtime guard
      lookupStandardValue({ species: "alpacas", ageCategory: "Adults" }),
    ).toThrow(UnknownLivestockClassError);
  });
});

// ── ±20% band (paragraph 6(1)(b)(ii)) ─────────────────────────────────────────

describe("withinTwentyPercentBand", () => {
  it("returns true when elected = standard", () => {
    expect(withinTwentyPercentBand(50, 50)).toBe(true);
  });
  it("returns true when elected = standard + exactly 20%", () => {
    expect(withinTwentyPercentBand(50, 60)).toBe(true);
  });
  it("returns true when elected = standard - exactly 20%", () => {
    expect(withinTwentyPercentBand(50, 40)).toBe(true);
  });
  it("returns false when elected = standard + 25%", () => {
    expect(withinTwentyPercentBand(50, 62.5)).toBe(false);
  });
  it("returns false when elected = standard - 25%", () => {
    expect(withinTwentyPercentBand(50, 37.5)).toBe(false);
  });
  it("returns true for exact zero standard (game) and zero elected", () => {
    expect(withinTwentyPercentBand(0, 0)).toBe(true);
  });
});

// ── effectiveValue with election + paragraph 7 lock-in ────────────────────────

describe("effectiveValue — no election", () => {
  it("returns standard value when no election", () => {
    const v = effectiveValue({
      class: { species: "cattle", ageCategory: "Bulls" },
    });
    expect(v).toBe(50);
  });

  it("returns standard value when election is null", () => {
    const v = effectiveValue({
      class: { species: "cattle", ageCategory: "Bulls" },
      election: null,
    });
    expect(v).toBe(50);
  });
});

describe("effectiveValue — election within ±20%", () => {
  const cls: LivestockClass = { species: "cattle", ageCategory: "Bulls" };

  it("applies elected R55 (within +10%)", () => {
    const election: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 55,
      electedYear: 2026,
    };
    expect(effectiveValue({ class: cls, election })).toBe(55);
  });

  it("applies elected R45 (within -10%)", () => {
    const election: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 45,
      electedYear: 2026,
    };
    expect(effectiveValue({ class: cls, election })).toBe(45);
  });
});

describe("effectiveValue — election outside ±20% throws", () => {
  it("throws ElectionExceedsTwentyPercentBandError for +25% election", () => {
    const election: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 62.5,
      electedYear: 2026,
    };
    expect(() =>
      effectiveValue({
        class: { species: "cattle", ageCategory: "Bulls" },
        election,
      }),
    ).toThrow(ElectionExceedsTwentyPercentBandError);
  });

  it("throws ElectionExceedsTwentyPercentBandError for -30% election", () => {
    const election: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 35,
      electedYear: 2026,
    };
    expect(() =>
      effectiveValue({
        class: { species: "cattle", ageCategory: "Bulls" },
        election,
      }),
    ).toThrow(ElectionExceedsTwentyPercentBandError);
  });
});

describe("effectiveValue — paragraph 7 lock-in", () => {
  const cls: LivestockClass = { species: "cattle", ageCategory: "Bulls" };

  it("permits initial election with no priorElection", () => {
    const election: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 55,
      electedYear: 2026,
    };
    expect(() => effectiveValue({ class: cls, election })).not.toThrow();
  });

  it("permits unchanged re-election (same value, same class) without SARS approval", () => {
    const election: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 55,
      electedYear: 2026,
    };
    const priorElection: ElectionRecord = { ...election, electedYear: 2025 };
    expect(() =>
      effectiveValue({ class: cls, election, priorElection }),
    ).not.toThrow();
  });

  it("throws ElectionLockInError when re-electing a different value without SARS approval ref", () => {
    const election: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 55,
      electedYear: 2026,
    };
    const priorElection: ElectionRecord = {
      ...election,
      electedYear: 2025,
      electedValueZar: 50,
    };
    expect(() =>
      effectiveValue({ class: cls, election, priorElection }),
    ).toThrow(ElectionLockInError);
  });

  it("permits re-election when sarsChangeApprovalRef is set", () => {
    const election: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 55,
      electedYear: 2026,
      sarsChangeApprovalRef: "SARS-2026-XYZ",
    };
    const priorElection: ElectionRecord = {
      ...election,
      electedYear: 2025,
      electedValueZar: 50,
      sarsChangeApprovalRef: null,
    };
    expect(() =>
      effectiveValue({ class: cls, election, priorElection }),
    ).not.toThrow();
  });
});

// ── STANDARD_VALUES integrity ─────────────────────────────────────────────────

describe("STANDARD_VALUES table integrity", () => {
  it("has no duplicate (species, ageCategory) pairs", () => {
    const seen = new Set<string>();
    for (const row of STANDARD_VALUES) {
      const key = `${row.class.species}/${row.class.ageCategory}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("every row has a non-empty source citation", () => {
    for (const row of STANDARD_VALUES) {
      expect(row.source.length).toBeGreaterThan(0);
    }
  });

  it("all R-values are non-negative integers", () => {
    for (const row of STANDARD_VALUES) {
      expect(Number.isInteger(row.zar)).toBe(true);
      expect(row.zar).toBeGreaterThanOrEqual(0);
    }
  });
});
