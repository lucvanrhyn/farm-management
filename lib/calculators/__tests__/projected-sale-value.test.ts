import { describe, it, expect } from "vitest";
import {
  estimateSaleValue,
  DEFAULT_MARKET_PRICE_PER_KG,
  DEFAULT_VALUE_PER_HEAD,
  type ProjectedSaleValueInput,
} from "@/lib/calculators/projected-sale-value";

const base: ProjectedSaleValueInput = {
  species: "cattle",
  latestWeightKg: null,
  estimatedValueOverride: null,
  marketPricePerKg: null,
  valuePerHead: null,
};

describe("estimateSaleValue — precedence (override > per-kg > per-head > none)", () => {
  it("override always wins, even when weight + prices are present", () => {
    const r = estimateSaleValue({
      ...base,
      latestWeightKg: 500,
      estimatedValueOverride: 80000,
      marketPricePerKg: 50,
      valuePerHead: 12000,
    });
    expect(r).toEqual({ value: 80000, basis: "override" });
  });

  it("override of 0 wins (explicit typed value, not falsy-skipped)", () => {
    const r = estimateSaleValue({ ...base, estimatedValueOverride: 0, latestWeightKg: 500 });
    expect(r).toEqual({ value: 0, basis: "override" });
  });

  it("per-kg using the resolved settings price when weight is present", () => {
    const r = estimateSaleValue({ ...base, latestWeightKg: 400, marketPricePerKg: 50 });
    expect(r).toEqual({ value: 20000, basis: "per-kg" });
  });

  it("per-kg falls back to DEFAULT_MARKET_PRICE_PER_KG[species] when no settings price", () => {
    const r = estimateSaleValue({ ...base, species: "cattle", latestWeightKg: 400 });
    expect(r).toEqual({ value: 400 * DEFAULT_MARKET_PRICE_PER_KG.cattle, basis: "per-kg" });
  });

  it("per-kg uses the sheep default for sheep", () => {
    const r = estimateSaleValue({ ...base, species: "sheep", latestWeightKg: 60 });
    expect(r).toEqual({ value: 60 * DEFAULT_MARKET_PRICE_PER_KG.sheep, basis: "per-kg" });
  });

  it("per-head fallback when there is no weight on record", () => {
    const r = estimateSaleValue({ ...base, species: "cattle", latestWeightKg: null, valuePerHead: 13000 });
    expect(r).toEqual({ value: 13000, basis: "per-head" });
  });

  it("per-head falls back to DEFAULT_VALUE_PER_HEAD[species] when no settings value", () => {
    const r = estimateSaleValue({ ...base, species: "sheep", latestWeightKg: null });
    expect(r).toEqual({ value: DEFAULT_VALUE_PER_HEAD.sheep, basis: "per-head" });
  });

  it("returns none for an unknown species with no weight, no settings, no override", () => {
    const r = estimateSaleValue({ ...base, species: "ostrich", latestWeightKg: null });
    expect(r).toEqual({ value: null, basis: "none" });
  });

  it("unknown species WITH a weight but no per-kg price (no default) tries per-head then none", () => {
    const r = estimateSaleValue({ ...base, species: "ostrich", latestWeightKg: 90 });
    // no per-kg default for ostrich and no settings price -> falls through to per-head -> none
    expect(r).toEqual({ value: null, basis: "none" });
  });

  it("unknown species with explicit per-kg settings price still computes per-kg", () => {
    const r = estimateSaleValue({ ...base, species: "ostrich", latestWeightKg: 90, marketPricePerKg: 70 });
    expect(r).toEqual({ value: 6300, basis: "per-kg" });
  });

  it("unknown species with explicit per-head settings value computes per-head when no weight", () => {
    const r = estimateSaleValue({ ...base, species: "ostrich", latestWeightKg: null, valuePerHead: 2500 });
    expect(r).toEqual({ value: 2500, basis: "per-head" });
  });
});
