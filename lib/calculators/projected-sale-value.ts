// lib/calculators/projected-sale-value.ts
//
// Pure calculator for an animal's PROJECTED sale value — the value driver for
// animals still on the farm (CONTEXT.md "Estimated sale value"). Realised
// margin needs a real sale Transaction; until then margin is projected against
// this estimate. Pure: no prisma, no IO.
//
// Two-tier model, cheapest input first, so it is populated on a zero-weights
// farm and sharpens as data accrues:
//   1. per-animal override (Animal.estimatedValue) — wins over everything for
//      the known exception (a stud bull worth R80k).
//   2. R/kg × latest logged weight — a *sale* price per kg keyed by species
//      (resolved upstream from FarmSettings.speciesAlertThresholds, else the
//      DEFAULT_MARKET_PRICE_PER_KG map). Weight gain enters margin through this
//      term (more kg × R/kg = higher projected value), not as a separate line.
//   3. flat R/head fallback — used when an animal has no weight on record (the
//      trio-b reality: sparse weights). Guarantees a populated projection.
//
// Projected ≠ realised: the caller shows projected margin distinctly and never
// silently sums it with banked margin (ADR-0012 honesty discipline).

/** Default *sale* price per kg per species, used when settings has no override. */
export const DEFAULT_MARKET_PRICE_PER_KG: Record<string, number> = {
  cattle: 45,
  sheep: 95,
};

/** Default flat value-per-head per species, used when no weight + no settings override. */
export const DEFAULT_VALUE_PER_HEAD: Record<string, number> = {
  cattle: 11000,
  sheep: 1900,
};

/** Which input produced the projected value (for honest "how computed" display). */
export type ProjectedBasis = "override" | "per-kg" | "per-head" | "none";

export interface ProjectedSaleValueInput {
  /** Animal.species (e.g. "cattle", "sheep"); drives the DEFAULT_* fallback. */
  species: string;
  /** kg of the most recent weighing observation, or null when never weighed. */
  latestWeightKg: number | null;
  /** Animal.estimatedValue — a single typed per-animal override, or null. */
  estimatedValueOverride: number | null;
  /** Resolved sale-price-per-kg from settings blob, else null (falls back to DEFAULT). */
  marketPricePerKg: number | null;
  /** Resolved flat value-per-head from settings blob, else null (falls back to DEFAULT). */
  valuePerHead: number | null;
}

/**
 * Estimate an animal's projected sale value. Precedence (cheapest-input-first,
 * override always wins):
 *   1. estimatedValueOverride != null            -> { value: override, basis: "override" }
 *   2. latestWeightKg != null && (marketPricePerKg ?? DEFAULT[species]) present -> per-kg
 *   3. (valuePerHead ?? DEFAULT_VALUE_PER_HEAD[species]) present -> per-head
 *   4. else { value: null, basis: "none" }
 */
export function estimateSaleValue(
  input: ProjectedSaleValueInput,
): { value: number | null; basis: ProjectedBasis } {
  const { species, latestWeightKg, estimatedValueOverride, marketPricePerKg, valuePerHead } = input;

  // 1. Per-animal override always wins.
  if (estimatedValueOverride != null) {
    return { value: estimatedValueOverride, basis: "override" };
  }

  // 2. R/kg × latest weight (resolved price else species default).
  if (latestWeightKg != null) {
    const pricePerKg = marketPricePerKg ?? DEFAULT_MARKET_PRICE_PER_KG[species];
    if (pricePerKg != null) {
      return { value: latestWeightKg * pricePerKg, basis: "per-kg" };
    }
  }

  // 3. Flat per-head fallback (resolved value else species default).
  const perHead = valuePerHead ?? DEFAULT_VALUE_PER_HEAD[species];
  if (perHead != null) {
    return { value: perHead, basis: "per-head" };
  }

  // 4. No estimate possible for this species.
  return { value: null, basis: "none" };
}
