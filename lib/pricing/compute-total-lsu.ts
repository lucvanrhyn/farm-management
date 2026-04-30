/**
 * lib/pricing/compute-total-lsu.ts — Canonical LSU-to-pricing bridge.
 *
 * Single source of truth for:
 *   - SPECIES_LSU_WEIGHTS: per-species LSU equivalence used by the billing
 *     calculator (distinct from the animal-category weights in species/ config.ts,
 *     which are per-category; here we use the representative adult weight).
 *   - GAME_BASIC_MONTHLY_ZAR / GAME_ADVANCED_MONTHLY_ZAR: flat monthly rate
 *     for game-only operations at a representative 200 LSU. Displayed on
 *     /subscribe and /pricing surfaces.
 *   - computeTotalLsu(): converts head-counts to a billing LSU total.
 *
 * Why separate from calculator.ts?
 *   calculator.ts takes a raw `lsu: number` and computes the tier price.
 *   This module converts head-counts to that number. The two compose cleanly:
 *     const lsu = computeTotalLsu({ cattle, sheep, goats, gameLsu });
 *     const quote = quoteTier('basic', lsu);
 *
 * SA LSU conventions (ARC/LNR standard, universally accepted by DALRRD):
 *   1 adult cow     = 1.00 LSU
 *   1 ewe / doe     = 0.17 LSU  (FarmTrack uses the upper end of the 0.15–0.17
 *                                 ARC range to match sheep/config.ts)
 *   1 goat          = 0.17 LSU  (SA standard: goats ≈ sheep for grazing load)
 *
 * Game LSU:
 *   Game species have per-species LSU equivalents stored in the GameSpecies
 *   table (impala ≈ 0.13, kudu ≈ 0.40, etc.). This module accepts a
 *   pre-computed gameLsu total — callers should use computeFarmLsuFromQueryResults
 *   from lib/pricing/farm-lsu.ts to obtain it.
 *
 * SYNC: If you change SPECIES_LSU_WEIGHTS or GAME_* constants, also update
 *   farm-website-v2/lib/pricing-lsu.ts (canonical copy comment at the top).
 */

// ── SA-standard per-species LSU weights (representative adult) ─────────────

export const SPECIES_LSU_WEIGHTS = {
  /** 1 adult cow = 1.00 LSU (ARC standard) */
  cattle: 1.0,
  /** 1 ewe = 0.17 LSU (ARC upper range, matches sheep/config.ts) */
  sheep: 0.17,
  /** 1 goat = 0.17 LSU (ARC: goats ≈ sheep for grazing load) */
  goats: 0.17,
} as const;

// ── Flat monthly rates for display surfaces ────────────────────────────────
//
// These are the rates shown on /subscribe and /register — a representative
// monthly cost at a typical 200-LSU farm. They are intentionally rounded to
// the nearest R50 for marketing clarity; the LSU calculator gives the precise
// per-farm rate.
//
// Basic at 200 LSU:  (R1,800 + R0.75 × 200) / 12 × 1.20 = R195 → display R200
// Advanced at 200 LSU: (R3,000 + R10 × 200) / 12 × 1.20 = R500 → display R500
//
// Game rates: same formula at 200 game-LSU (a mid-size game operation).
// Game farms are typically Advanced due to the census / quota / veld features.

/** Basic plan flat display price (ZAR/month). Used on /register and /subscribe. */
export const BASIC_DISPLAY_MONTHLY_ZAR = 200 as const;

/** Advanced plan flat display price (ZAR/month). Used on /subscribe. */
export const ADVANCED_DISPLAY_MONTHLY_ZAR = 500 as const;

/**
 * Game Basic monthly flat display rate (ZAR/month).
 * Equivalent to Basic at 200 LSU with a 20% monthly premium.
 * Rounded to nearest R50 for display clarity.
 */
export const GAME_BASIC_MONTHLY_ZAR = 200 as const;

/**
 * Game Advanced monthly flat display rate (ZAR/month).
 * Game operations use Advanced for the census, quota and veld-score modules.
 * Equivalent to Advanced at 200 LSU.
 */
export const GAME_ADVANCED_MONTHLY_ZAR = 500 as const;

// ── computeTotalLsu ────────────────────────────────────────────────────────

export interface TotalLsuInput {
  /** Head count of cattle (adult equivalents). Each counts as 1.00 LSU. */
  readonly cattle: number;
  /** Head count of sheep (adult ewes). Each counts as 0.17 LSU. */
  readonly sheep: number;
  /** Head count of goats. Each counts as 0.17 LSU. */
  readonly goats: number;
  /**
   * Pre-computed total game LSU (species-specific, from GameSpecies table).
   * Use computeFarmLsuFromQueryResults() to obtain this value.
   * Pass as 0 for non-game operations.
   */
  readonly gameLsu: number;
}

/**
 * Convert raw head-counts + pre-computed game LSU into a total billing LSU.
 *
 * Rounds once at the end — never per-species — to avoid cumulative drift.
 * Return value is always an integer (safe for PayFast amountZar when combined
 * with the tier calculator).
 *
 * @example
 *   const lsu = computeTotalLsu({ cattle: 200, sheep: 600, goats: 0, gameLsu: 0 });
 *   // → 302 (200*1.0 + 600*0.17 = 302)
 *   const quote = quoteTier('basic', lsu);
 */
export function computeTotalLsu(input: TotalLsuInput): number {
  const raw =
    input.cattle * SPECIES_LSU_WEIGHTS.cattle +
    input.sheep * SPECIES_LSU_WEIGHTS.sheep +
    input.goats * SPECIES_LSU_WEIGHTS.goats +
    input.gameLsu;
  return Math.round(raw);
}
