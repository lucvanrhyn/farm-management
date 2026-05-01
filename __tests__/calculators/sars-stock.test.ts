/**
 * __tests__/calculators/sars-stock.test.ts
 *
 * TDD tests for the per-class stock-block valuation + opening/closing movement
 * delta and the FarmTrack -> SARS class mapper.
 *
 * Source: First Schedule paragraph 5(1) (gazetted standard values) and IT35
 * §3.4 (natural increase in closing stock at standard value, deaths drop out).
 */

import { describe, it, expect } from "vitest";
import {
  valueStockBlock,
  summariseStockMovement,
  mapFarmTrackCategoryToSarsClass,
  type AnimalSnapshot,
} from "@/lib/calculators/sars-stock";
import {
  UnknownLivestockClassError,
  type ElectionRecord,
} from "@/lib/calculators/sars-livestock-values";

// ── valueStockBlock ──────────────────────────────────────────────────────────

describe("valueStockBlock", () => {
  it("100 bulls + 200 cows = 100*R50 + 200*R40 = R13000", () => {
    const snapshot: AnimalSnapshot[] = [
      { species: "cattle", ageCategory: "Bulls", count: 100 },
      { species: "cattle", ageCategory: "Cows", count: 200 },
    ];
    const result = valueStockBlock(snapshot, []);
    expect(result.totalZar).toBe(13_000);
    expect(result.lines).toHaveLength(2);
    expect(result.electionApplied).toBe(false);
  });

  it("zero-count classes still produce a line at R0", () => {
    const snapshot: AnimalSnapshot[] = [
      { species: "cattle", ageCategory: "Bulls", count: 0 },
    ];
    const result = valueStockBlock(snapshot, []);
    expect(result.totalZar).toBe(0);
    expect(result.lines[0].subtotalZar).toBe(0);
  });

  it("applies election to a class within ±20%", () => {
    const snapshot: AnimalSnapshot[] = [
      { species: "cattle", ageCategory: "Bulls", count: 10 },
    ];
    const elections: ElectionRecord[] = [
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 55,
        electedYear: 2026,
      },
    ];
    const result = valueStockBlock(snapshot, elections);
    expect(result.totalZar).toBe(10 * 55);
    expect(result.lines[0].standardValueZar).toBe(50);
    expect(result.lines[0].effectiveValueZar).toBe(55);
    expect(result.electionApplied).toBe(true);
  });

  it("game class returns 0 for the line subtotal (SARS-accepted nil)", () => {
    const snapshot: AnimalSnapshot[] = [
      { species: "game", ageCategory: "Adult Male", count: 50 },
    ];
    const result = valueStockBlock(snapshot, []);
    expect(result.totalZar).toBe(0);
  });

  it("aggregates multiple species correctly", () => {
    const snapshot: AnimalSnapshot[] = [
      { species: "cattle", ageCategory: "Bulls", count: 5 },     // 5 * 50 = 250
      { species: "sheep", ageCategory: "Ewes", count: 100 },     // 100 * 6 = 600
      { species: "goats", ageCategory: "Fully grown", count: 50 }, // 50 * 4 = 200
    ];
    const result = valueStockBlock(snapshot, []);
    expect(result.totalZar).toBe(1050);
  });
});

// ── summariseStockMovement ───────────────────────────────────────────────────

describe("summariseStockMovement", () => {
  it("opening = closing → delta 0", () => {
    const opening: AnimalSnapshot[] = [
      { species: "cattle", ageCategory: "Bulls", count: 100 },
    ];
    const closing: AnimalSnapshot[] = [
      { species: "cattle", ageCategory: "Bulls", count: 100 },
    ];
    const delta = summariseStockMovement(opening, closing, []);
    expect(delta.openingStockValueZar).toBe(5000);
    expect(delta.closingStockValueZar).toBe(5000);
    expect(delta.deltaZar).toBe(0);
  });

  it("opening 100 bulls + closing 200 bulls → delta R5000", () => {
    const opening: AnimalSnapshot[] = [
      { species: "cattle", ageCategory: "Bulls", count: 100 },
    ];
    const closing: AnimalSnapshot[] = [
      { species: "cattle", ageCategory: "Bulls", count: 200 },
    ];
    const delta = summariseStockMovement(opening, closing, []);
    expect(delta.openingStockValueZar).toBe(5_000);
    expect(delta.closingStockValueZar).toBe(10_000);
    expect(delta.deltaZar).toBe(5_000);
  });

  it("opening 200 bulls + closing 100 bulls → delta -R5000", () => {
    const opening: AnimalSnapshot[] = [
      { species: "cattle", ageCategory: "Bulls", count: 200 },
    ];
    const closing: AnimalSnapshot[] = [
      { species: "cattle", ageCategory: "Bulls", count: 100 },
    ];
    const delta = summariseStockMovement(opening, closing, []);
    expect(delta.deltaZar).toBe(-5_000);
  });
});

// ── mapFarmTrackCategoryToSarsClass ──────────────────────────────────────────

describe("mapFarmTrackCategoryToSarsClass — cattle", () => {
  const yearEnd = new Date("2026-02-28T00:00:00.000Z");

  it("Bull -> cattle/Bulls", () => {
    const cls = mapFarmTrackCategoryToSarsClass({
      farmTrackCategory: "Bull",
      species: "cattle",
      birthDate: null,
      asOfDate: yearEnd,
    });
    expect(cls).toEqual({ species: "cattle", ageCategory: "Bulls" });
  });

  it("Cow -> cattle/Cows", () => {
    const cls = mapFarmTrackCategoryToSarsClass({
      farmTrackCategory: "Cow",
      species: "cattle",
      birthDate: null,
      asOfDate: yearEnd,
    });
    expect(cls).toEqual({ species: "cattle", ageCategory: "Cows" });
  });

  it("Ox -> cattle/Oxen", () => {
    const cls = mapFarmTrackCategoryToSarsClass({
      farmTrackCategory: "Ox",
      species: "cattle",
      birthDate: null,
      asOfDate: yearEnd,
    });
    expect(cls).toEqual({ species: "cattle", ageCategory: "Oxen" });
  });

  it("Heifer aged 1-2 years -> cattle/Tollies & heifers 1-2 years", () => {
    const birth = new Date("2024-08-01T00:00:00.000Z"); // ~1.5y at yearEnd
    const cls = mapFarmTrackCategoryToSarsClass({
      farmTrackCategory: "Heifer",
      species: "cattle",
      birthDate: birth.toISOString(),
      asOfDate: yearEnd,
    });
    expect(cls.ageCategory).toBe("Tollies & heifers 1-2 years");
  });

  it("Heifer aged 2-3 years -> cattle/Tollies & heifers 2-3 years", () => {
    const birth = new Date("2023-08-01T00:00:00.000Z"); // ~2.5y at yearEnd
    const cls = mapFarmTrackCategoryToSarsClass({
      farmTrackCategory: "Heifer",
      species: "cattle",
      birthDate: birth.toISOString(),
      asOfDate: yearEnd,
    });
    expect(cls.ageCategory).toBe("Tollies & heifers 2-3 years");
  });

  it("Heifer aged 3+ years rolls to Cows", () => {
    const birth = new Date("2022-01-01T00:00:00.000Z"); // ~4y
    const cls = mapFarmTrackCategoryToSarsClass({
      farmTrackCategory: "Heifer",
      species: "cattle",
      birthDate: birth.toISOString(),
      asOfDate: yearEnd,
    });
    expect(cls.ageCategory).toBe("Cows");
  });

  it("Calf -> cattle/Calves", () => {
    const cls = mapFarmTrackCategoryToSarsClass({
      farmTrackCategory: "Calf",
      species: "cattle",
      birthDate: "2025-12-01",
      asOfDate: yearEnd,
    });
    expect(cls.ageCategory).toBe("Calves");
  });
});

describe("mapFarmTrackCategoryToSarsClass — sheep", () => {
  const yearEnd = new Date("2026-02-28T00:00:00.000Z");

  it("Ram -> sheep/Rams", () => {
    expect(
      mapFarmTrackCategoryToSarsClass({
        farmTrackCategory: "Ram",
        species: "sheep",
        birthDate: null,
        asOfDate: yearEnd,
      }),
    ).toEqual({ species: "sheep", ageCategory: "Rams" });
  });
  it("Ewe -> sheep/Ewes", () => {
    expect(
      mapFarmTrackCategoryToSarsClass({
        farmTrackCategory: "Ewe",
        species: "sheep",
        birthDate: null,
        asOfDate: yearEnd,
      }),
    ).toEqual({ species: "sheep", ageCategory: "Ewes" });
  });
  it("Wether -> sheep/Wethers", () => {
    expect(
      mapFarmTrackCategoryToSarsClass({
        farmTrackCategory: "Wether",
        species: "sheep",
        birthDate: null,
        asOfDate: yearEnd,
      }),
    ).toEqual({ species: "sheep", ageCategory: "Wethers" });
  });
  it("Lamb -> sheep/Weaned lambs", () => {
    expect(
      mapFarmTrackCategoryToSarsClass({
        farmTrackCategory: "Lamb",
        species: "sheep",
        birthDate: "2025-11-01",
        asOfDate: yearEnd,
      }),
    ).toEqual({ species: "sheep", ageCategory: "Weaned lambs" });
  });
});

describe("mapFarmTrackCategoryToSarsClass — game", () => {
  const yearEnd = new Date("2026-02-28T00:00:00.000Z");

  it("any game category -> game/<original>", () => {
    expect(
      mapFarmTrackCategoryToSarsClass({
        farmTrackCategory: "Adult Male",
        species: "game",
        birthDate: null,
        asOfDate: yearEnd,
      }),
    ).toEqual({ species: "game", ageCategory: "Adult Male" });
  });
});

describe("mapFarmTrackCategoryToSarsClass — unmapped", () => {
  const yearEnd = new Date("2026-02-28T00:00:00.000Z");

  it("throws UnknownLivestockClassError for unmapped FarmTrack category", () => {
    expect(() =>
      mapFarmTrackCategoryToSarsClass({
        farmTrackCategory: "Wagyu Wagons",
        species: "cattle",
        birthDate: null,
        asOfDate: yearEnd,
      }),
    ).toThrow(UnknownLivestockClassError);
  });
});
