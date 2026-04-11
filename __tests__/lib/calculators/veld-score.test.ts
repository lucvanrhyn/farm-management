import { describe, it, expect } from 'vitest';
import {
  calcVeldScore,
  calcGrazingCapacity,
  calcTrendSlope,
  resolveRestDayModifier,
  BIOME_LTGC_BASELINE,
  type VeldInputs,
  type BiomeType,
} from '@/lib/calculators/veld-score';

const BASE: VeldInputs = {
  palatableSpeciesPct: 60,
  bareGroundPct: 10,
  erosionLevel: 0,
  bushEncroachmentLevel: 0,
};

describe('calcVeldScore', () => {
  it('returns 10 for pristine veld', () => {
    expect(
      calcVeldScore({
        palatableSpeciesPct: 100,
        bareGroundPct: 0,
        erosionLevel: 0,
        bushEncroachmentLevel: 0,
      }),
    ).toBe(10);
  });

  it('returns 0 for fully degraded veld', () => {
    expect(
      calcVeldScore({
        palatableSpeciesPct: 0,
        bareGroundPct: 100,
        erosionLevel: 2,
        bushEncroachmentLevel: 2,
      }),
    ).toBe(0);
  });

  it('returns ~6 for a typical good-condition camp', () => {
    const score = calcVeldScore(BASE);
    expect(score).toBeGreaterThanOrEqual(5.5);
    expect(score).toBeLessThanOrEqual(6.5);
  });

  it('penalises erosion', () => {
    const noErosion = calcVeldScore({ ...BASE, erosionLevel: 0 });
    const severeErosion = calcVeldScore({ ...BASE, erosionLevel: 2 });
    expect(severeErosion).toBeLessThan(noErosion - 1);
  });

  it('penalises bush encroachment', () => {
    const noBush = calcVeldScore({ ...BASE, bushEncroachmentLevel: 0 });
    const denseBush = calcVeldScore({ ...BASE, bushEncroachmentLevel: 2 });
    expect(denseBush).toBeLessThan(noBush - 1);
  });

  it('clamps palatable-species % to [0, 100]', () => {
    expect(calcVeldScore({ ...BASE, palatableSpeciesPct: 150 })).toBeLessThanOrEqual(10);
    expect(calcVeldScore({ ...BASE, palatableSpeciesPct: -10 })).toBeGreaterThanOrEqual(0);
  });

  it('rounds to 1 decimal place', () => {
    const score = calcVeldScore(BASE);
    expect(score).toBe(Number(score.toFixed(1)));
  });
});

describe('calcGrazingCapacity', () => {
  it('Highveld baseline is 5 ha/LSU at score 8', () => {
    const gc = calcGrazingCapacity('highveld', 8);
    expect(gc.haPerLsu).toBeCloseTo(5, 1);
  });

  it('doubles required area when score halves', () => {
    const gcGood = calcGrazingCapacity('bushveld', 8);
    const gcHalf = calcGrazingCapacity('bushveld', 4);
    expect(gcHalf.haPerLsu).toBeCloseTo(gcGood.haPerLsu! * 2, 1);
  });

  it('Karoo baseline is much higher than Highveld', () => {
    const karoo = calcGrazingCapacity('karoo', 8);
    const highveld = calcGrazingCapacity('highveld', 8);
    expect(karoo.haPerLsu!).toBeGreaterThan(highveld.haPerLsu! * 3);
  });

  it('derives lsuPerHa as inverse', () => {
    const gc = calcGrazingCapacity('highveld', 8);
    expect(gc.lsuPerHa).toBeCloseTo(1 / gc.haPerLsu!, 4);
  });

  it('returns null for score 0 (cannot support any stock)', () => {
    expect(calcGrazingCapacity('highveld', 0).haPerLsu).toBeNull();
  });

  it('unknown biome falls back to mixedveld average', () => {
    const gc = calcGrazingCapacity('unknown' as BiomeType, 8);
    expect(gc.haPerLsu).not.toBeNull();
  });
});

describe('calcTrendSlope', () => {
  it('returns 0 for single observation', () => {
    expect(calcTrendSlope([{ date: '2026-01-01', score: 6 }])).toBe(0);
  });

  it('returns positive slope for improving veld', () => {
    const slope = calcTrendSlope([
      { date: '2025-01-01', score: 4 },
      { date: '2025-07-01', score: 5 },
      { date: '2026-01-01', score: 6 },
    ]);
    expect(slope).toBeGreaterThan(0);
  });

  it('returns negative slope for declining veld', () => {
    const slope = calcTrendSlope([
      { date: '2025-01-01', score: 7 },
      { date: '2025-07-01', score: 6 },
      { date: '2026-01-01', score: 5 },
    ]);
    expect(slope).toBeLessThan(0);
  });

  it('slope is per month, not per day', () => {
    const slope = calcTrendSlope([
      { date: '2025-01-01', score: 4 },
      { date: '2026-01-01', score: 6 },
    ]);
    // +2 points over 12 months ≈ 0.167/month
    expect(slope).toBeCloseTo(2 / 12, 2);
  });

  it('returns 0 for flat trend', () => {
    const slope = calcTrendSlope([
      { date: '2025-01-01', score: 6 },
      { date: '2026-01-01', score: 6 },
    ]);
    expect(slope).toBeCloseTo(0, 3);
  });

  it('sorts observations by date before computing', () => {
    const out = calcTrendSlope([
      { date: '2026-01-01', score: 6 },
      { date: '2025-01-01', score: 4 },
    ]);
    const ordered = calcTrendSlope([
      { date: '2025-01-01', score: 4 },
      { date: '2026-01-01', score: 6 },
    ]);
    expect(out).toBeCloseTo(ordered, 4);
  });
});

describe('resolveRestDayModifier', () => {
  it('returns 1.0 when no veld score supplied (no effect)', () => {
    expect(resolveRestDayModifier(null)).toBe(1);
  });

  it('returns 1.0 for score >= 7 (veld is fine)', () => {
    expect(resolveRestDayModifier(7)).toBe(1);
    expect(resolveRestDayModifier(9)).toBe(1);
  });

  it('extends rest 30% for fair veld (score 4–6.9)', () => {
    expect(resolveRestDayModifier(5)).toBeCloseTo(1.3, 2);
  });

  it('extends rest 60% for poor veld (score < 4)', () => {
    expect(resolveRestDayModifier(3)).toBeCloseTo(1.6, 2);
    expect(resolveRestDayModifier(1)).toBeCloseTo(1.6, 2);
  });

  it('never exceeds the 1.6× cap', () => {
    expect(resolveRestDayModifier(0)).toBeLessThanOrEqual(1.6);
  });
});

describe('BIOME_LTGC_BASELINE', () => {
  it('covers the 5 core SA biomes', () => {
    expect(BIOME_LTGC_BASELINE.highveld).toBeGreaterThan(0);
    expect(BIOME_LTGC_BASELINE.bushveld).toBeGreaterThan(0);
    expect(BIOME_LTGC_BASELINE.karoo).toBeGreaterThan(0);
    expect(BIOME_LTGC_BASELINE.lowveld).toBeGreaterThan(0);
    expect(BIOME_LTGC_BASELINE.mixedveld).toBeGreaterThan(0);
  });
});
