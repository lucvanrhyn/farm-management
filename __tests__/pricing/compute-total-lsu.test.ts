/**
 * TDD: RED → GREEN → REFACTOR
 *
 * Tests for computeTotalLsu() and SPECIES_LSU_WEIGHTS from
 * lib/pricing/compute-total-lsu.ts.
 *
 * SA conventional LSU weights (ARC/LNR standard):
 *   Cattle (Cow):  1.00 LSU
 *   Cattle (Bull): 1.50 LSU
 *   Sheep (Ewe):   0.17 LSU (most sources use 0.15–0.17; FarmTrack uses 0.17
 *                             per sheep/config.ts to match ARC range tops)
 *   Goat (Doe):    0.17 LSU (ARC: 6 small stock = 1 LSU; goats ≈ sheep)
 *
 * Game rate is not expressed as a per-head LSU here — game LSU is driven by
 * the GameSpecies.lsuEquivalent column (species-specific). The gameLsu param
 * accepts a pre-computed game LSU total (already summed upstream by
 * computeFarmLsuFromQueryResults).
 *
 * BenguFarm 300-LSU reference fixture:
 *   BenguFarm's published pricing tiers use a 300-LSU mixed-farm example.
 *   We model this as: 200 Cow + 600 Ewe (≈ 200 + 102 = 302 LSU ≈ 300 LSU).
 *   This is an approximation; the exact mix is unverified from their public
 *   site (accessed 2026-04-29) which only quotes the 300-LSU total without
 *   species breakdown. We document the assumed mix here so that if the real
 *   mix is ever published, this fixture can be updated.
 */

import { describe, it, expect } from 'vitest';
import {
  SPECIES_LSU_WEIGHTS,
  GAME_BASIC_MONTHLY_ZAR,
  GAME_ADVANCED_MONTHLY_ZAR,
  computeTotalLsu,
} from '@/lib/pricing/compute-total-lsu';

// ── Test 1: Cattle-only ──────────────────────────────────────────────────────

describe('computeTotalLsu — cattle only', () => {
  it('300 cattle (Cow) → 300 LSU', () => {
    // 300 × 1.0 LSU/Cow = 300 LSU
    const result = computeTotalLsu({ cattle: 300, sheep: 0, goats: 0, gameLsu: 0 });
    expect(result).toBe(300);
  });

  it('uses SA-standard 1.0 LSU per adult cow', () => {
    expect(SPECIES_LSU_WEIGHTS.cattle).toBe(1.0);
  });

  it('0 cattle → 0 LSU', () => {
    const result = computeTotalLsu({ cattle: 0, sheep: 0, goats: 0, gameLsu: 0 });
    expect(result).toBe(0);
  });

  it('1 cattle → 1 LSU (exact integer, no rounding drift)', () => {
    const result = computeTotalLsu({ cattle: 1, sheep: 0, goats: 0, gameLsu: 0 });
    expect(result).toBe(1);
  });
});

// ── Test 2: Mixed cattle + sheep ─────────────────────────────────────────────

describe('computeTotalLsu — mixed cattle + sheep', () => {
  it('100 cattle + 500 sheep → 100 + 85 = 185 LSU', () => {
    // 100 × 1.0 = 100; 500 × 0.17 = 85; total = 185
    const result = computeTotalLsu({ cattle: 100, sheep: 500, goats: 0, gameLsu: 0 });
    expect(result).toBe(185);
  });

  it('0 cattle + 1000 sheep → 170 LSU', () => {
    // 1000 × 0.17 = 170
    const result = computeTotalLsu({ cattle: 0, sheep: 1000, goats: 0, gameLsu: 0 });
    expect(result).toBe(170);
  });

  it('uses SA-standard 0.17 LSU per ewe', () => {
    expect(SPECIES_LSU_WEIGHTS.sheep).toBe(0.17);
  });

  it('fractional LSU from sheep rounds to nearest integer', () => {
    // 33 sheep × 0.17 = 5.61 → rounds to 6
    const result = computeTotalLsu({ cattle: 0, sheep: 33, goats: 0, gameLsu: 0 });
    expect(result).toBe(6);
  });
});

// ── Test 3: Mixed cattle + sheep + game (pre-computed gameLsu) ───────────────

describe('computeTotalLsu — mixed cattle + sheep + game LSU', () => {
  it('100 cattle + 500 sheep + 50 gameLsu → 100 + 85 + 50 = 235 LSU', () => {
    const result = computeTotalLsu({ cattle: 100, sheep: 500, goats: 0, gameLsu: 50 });
    expect(result).toBe(235);
  });

  it('0 cattle + 0 sheep + 170 gameLsu → 170 LSU', () => {
    // pure game operation
    const result = computeTotalLsu({ cattle: 0, sheep: 0, goats: 0, gameLsu: 170 });
    expect(result).toBe(170);
  });

  it('gameLsu fractional values are included before final rounding', () => {
    // 1 cattle + 1 sheep + 0.5 gameLsu = 1 + 0.17 + 0.5 = 1.67 → rounds to 2
    const result = computeTotalLsu({ cattle: 1, sheep: 1, goats: 0, gameLsu: 0.5 });
    expect(result).toBe(2);
  });
});

// ── Test 4: BenguFarm 300-LSU reference fixture ──────────────────────────────

describe('computeTotalLsu — BenguFarm 300-LSU mixed-farm reference', () => {
  /**
   * Fixture: 200 Cow + 600 Ewe.
   * Assumed mix (BenguFarm publish only the 300-LSU total, not the breakdown).
   * 200 × 1.0 + 600 × 0.17 = 200 + 102 = 302 LSU (rounds to 302).
   *
   * This is used as a reference farm for pricing tier comparison with BenguFarm.
   * At 302 LSU:
   *   FarmTrack Basic monthly  = (R1,800 + R0.75 × 302) / 12 × 1.20
   *                            = R2,026.50 / 12 × 1.20 ≈ R202.65 → R203
   *   FarmTrack Advanced monthly = (R3,000 + R10 × 302) / 12 × 1.20
   *                              = R6,020 / 12 × 1.20 ≈ R602
   */
  it('200 cattle + 600 sheep → 302 LSU (BenguFarm 300-LSU reference)', () => {
    const result = computeTotalLsu({ cattle: 200, sheep: 600, goats: 0, gameLsu: 0 });
    // 200*1.0 + 600*0.17 = 200 + 102 = 302
    expect(result).toBe(302);
  });

  it('302 LSU is above the 300-LSU BenguFarm reference (mix assumed, not published)', () => {
    const lsu = computeTotalLsu({ cattle: 200, sheep: 600, goats: 0, gameLsu: 0 });
    // Document that our approximation lands within 5 LSU of the 300-LSU published figure.
    // If BenguFarm's exact mix is ever discovered, update the fixture above.
    expect(Math.abs(lsu - 300)).toBeLessThanOrEqual(5);
  });
});

// ── Test 5: Goats ────────────────────────────────────────────────────────────

describe('computeTotalLsu — goats', () => {
  it('uses 0.17 LSU per goat (same as sheep, per SA convention)', () => {
    expect(SPECIES_LSU_WEIGHTS.goats).toBe(0.17);
  });

  it('100 goats → 17 LSU', () => {
    const result = computeTotalLsu({ cattle: 0, sheep: 0, goats: 100, gameLsu: 0 });
    expect(result).toBe(17);
  });

  it('mixed: 10 cattle + 10 sheep + 10 goats = 10 + 1.7 + 1.7 = 13.4 → 13 LSU', () => {
    const result = computeTotalLsu({ cattle: 10, sheep: 10, goats: 10, gameLsu: 0 });
    // 10*1.0 + 10*0.17 + 10*0.17 = 10 + 1.7 + 1.7 = 13.4 → Math.round → 13
    expect(result).toBe(13);
  });
});

// ── Test 6: Game pricing constants ───────────────────────────────────────────

describe('game pricing constants', () => {
  it('GAME_BASIC_MONTHLY_ZAR is a positive integer (used for PayFast amount)', () => {
    expect(Number.isInteger(GAME_BASIC_MONTHLY_ZAR)).toBe(true);
    expect(GAME_BASIC_MONTHLY_ZAR).toBeGreaterThan(0);
  });

  it('GAME_ADVANCED_MONTHLY_ZAR is a positive integer', () => {
    expect(Number.isInteger(GAME_ADVANCED_MONTHLY_ZAR)).toBe(true);
    expect(GAME_ADVANCED_MONTHLY_ZAR).toBeGreaterThan(0);
  });

  it('GAME_ADVANCED is priced higher than GAME_BASIC', () => {
    expect(GAME_ADVANCED_MONTHLY_ZAR).toBeGreaterThan(GAME_BASIC_MONTHLY_ZAR);
  });
});

// ── Test 7: Edge cases ───────────────────────────────────────────────────────

describe('computeTotalLsu — edge cases', () => {
  it('all-zero inputs → 0', () => {
    expect(computeTotalLsu({ cattle: 0, sheep: 0, goats: 0, gameLsu: 0 })).toBe(0);
  });

  it('large-scale: 5000 cattle + 10000 sheep → 6700 LSU', () => {
    // 5000*1.0 + 10000*0.17 = 5000 + 1700 = 6700
    const result = computeTotalLsu({ cattle: 5000, sheep: 10000, goats: 0, gameLsu: 0 });
    expect(result).toBe(6700);
  });

  it('returns an integer (Math.round applied)', () => {
    // Any combination should produce an integer result
    const result = computeTotalLsu({ cattle: 7, sheep: 13, goats: 3, gameLsu: 2.3 });
    expect(Number.isInteger(result)).toBe(true);
  });
});
