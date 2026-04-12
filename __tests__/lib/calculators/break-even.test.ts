import { describe, it, expect } from 'vitest';
import {
  calcDaysOnFeed,
  calcFeedCost,
  calcTotalCostPerAnimal,
  calcBreakEvenPrices,
  calcSensitivityTable,
  type BreakEvenInputs,
} from '@/lib/calculators/break-even';

const BASE: BreakEvenInputs = {
  purchaseMassKg: 250,
  purchasePricePerKg: 32,
  targetMassKg: 420,
  adgKgPerDay: 1.2,
  feedCostMode: 'daily_rate',
  feedCostPerDay: 18,
  transportInPerAnimal: 150,
  transportOutPerAnimal: 200,
  vetMedsPerAnimal: 80,
  mortalityPercent: 2,
  fixedOverheadPerAnimal: 0,
};

describe('calcDaysOnFeed', () => {
  it('derives days from mass gain / ADG', () => {
    // (420 - 250) / 1.2 = 141.67
    expect(calcDaysOnFeed(250, 420, 1.2)).toBeCloseTo(141.67, 1);
  });

  it('returns 0 when target equals purchase mass', () => {
    expect(calcDaysOnFeed(300, 300, 1.0)).toBe(0);
  });

  it('handles fractional ADG', () => {
    expect(calcDaysOnFeed(100, 200, 0.5)).toBeCloseTo(200, 0);
  });
});

describe('calcFeedCost', () => {
  it('calculates daily_rate feed cost correctly', () => {
    const days = calcDaysOnFeed(250, 420, 1.2); // ~141.67 days
    const cost = calcFeedCost({ mode: 'daily_rate', feedCostPerDay: 18, days });
    expect(cost).toBeCloseTo(141.67 * 18, 0);
  });

  it('calculates FCR-based feed cost correctly', () => {
    // FCR 6 kg feed per kg gain, R4/kg feed, 100 kg gain
    const cost = calcFeedCost({ mode: 'fcr', fcr: 6, feedPricePerKg: 4, massGainKg: 100 });
    expect(cost).toBeCloseTo(2400, 0);
  });

  it('throws when daily_rate mode missing feedCostPerDay', () => {
    expect(() =>
      calcFeedCost({ mode: 'daily_rate', days: 100 })
    ).toThrow();
  });

  it('throws when fcr mode missing fcr or feedPricePerKg', () => {
    expect(() =>
      calcFeedCost({ mode: 'fcr', massGainKg: 100 })
    ).toThrow();
  });
});

describe('calcTotalCostPerAnimal', () => {
  it('sums purchase, feed, transport, vet, mortality loading, and overhead', () => {
    const result = calcTotalCostPerAnimal(BASE);
    // purchase: 250 * 32 = 8000
    // days: (420 - 250) / 1.2 ≈ 141.67
    // feed: 141.67 * 18 ≈ 2550
    // transport: 150 + 200 = 350
    // vet: 80
    // mortality loading: total_so_far * 0.02 / (1 - 0.02)
    // overhead: 0
    const purchaseCost = 250 * 32; // 8000
    const days = (420 - 250) / 1.2;
    const feedCost = days * 18;
    const variableBeforeMortality = purchaseCost + feedCost + 350 + 80;
    const mortalityLoading = variableBeforeMortality * (0.02 / (1 - 0.02));
    const expected = variableBeforeMortality + mortalityLoading;
    expect(result.totalCostPerAnimal).toBeCloseTo(expected, 0);
  });

  it('returns zero mass gain when target equals purchase mass', () => {
    const inputs: BreakEvenInputs = { ...BASE, targetMassKg: 250 };
    const result = calcTotalCostPerAnimal(inputs);
    expect(result.massGainedKg).toBe(0);
  });

  it('uses FCR mode feed cost when feedCostMode is fcr', () => {
    const inputs: BreakEvenInputs = {
      ...BASE,
      feedCostMode: 'fcr',
      fcr: 7,
      feedPricePerKg: 4,
    };
    const result = calcTotalCostPerAnimal(inputs);
    const massGain = 420 - 250; // 170 kg
    const expectedFeedCost = 170 * 7 * 4; // 4760
    // Just verify feed cost is much larger than daily_rate path
    expect(result.totalFeedCostPerAnimal).toBeCloseTo(expectedFeedCost, 0);
  });

  it('includes fixed overhead', () => {
    const inputs: BreakEvenInputs = { ...BASE, fixedOverheadPerAnimal: 500 };
    const base = calcTotalCostPerAnimal(BASE);
    const withOverhead = calcTotalCostPerAnimal(inputs);
    expect(withOverhead.totalCostPerAnimal).toBeCloseTo(base.totalCostPerAnimal + 500, 0);
  });
});

describe('calcBreakEvenPrices', () => {
  it('returns break-even at 0% margin (sell = cost)', () => {
    const costs = calcTotalCostPerAnimal(BASE);
    const prices = calcBreakEvenPrices(costs.totalCostPerAnimal, BASE.targetMassKg);
    expect(prices[0].margin).toBe(0);
    expect(prices[0].pricePerAnimal).toBeCloseTo(costs.totalCostPerAnimal, 0);
    expect(prices[0].pricePerKg).toBeCloseTo(costs.totalCostPerAnimal / BASE.targetMassKg, 2);
  });

  it('adds 10% margin correctly', () => {
    const totalCost = 10000;
    const prices = calcBreakEvenPrices(totalCost, 400);
    expect(prices[1].margin).toBe(10);
    expect(prices[1].pricePerAnimal).toBeCloseTo(10000 * 1.1, 0);
    expect(prices[1].pricePerKg).toBeCloseTo(10000 * 1.1 / 400, 2);
  });

  it('returns three margin points: 0%, 10%, 20%', () => {
    const prices = calcBreakEvenPrices(5000, 300);
    expect(prices).toHaveLength(3);
    expect(prices.map((p) => p.margin)).toEqual([0, 10, 20]);
  });
});

describe('calcSensitivityTable', () => {
  it('returns a 5×5 grid', () => {
    const costs = calcTotalCostPerAnimal(BASE);
    const table = calcSensitivityTable(costs.totalCostPerAnimal, BASE.targetMassKg);
    expect(table).toHaveLength(5);
    table.forEach((row) => expect(row).toHaveLength(5));
  });

  it('cell with 0% margin matches break-even price at that mass', () => {
    const costs = calcTotalCostPerAnimal(BASE);
    const table = calcSensitivityTable(costs.totalCostPerAnimal, BASE.targetMassKg);
    // Find the row/column corresponding to the base target mass and 0% margin
    const baseRow = table.find((r) => r[0].targetMass === BASE.targetMassKg);
    const zeroMarginCell = baseRow?.find((c) => c.marginPercent === 0);
    expect(zeroMarginCell?.pricePerKg).toBeCloseTo(
      costs.totalCostPerAnimal / BASE.targetMassKg, 2
    );
  });

  it('higher target mass → lower break-even price per kg (dilutes fixed purchase cost)', () => {
    const costs = calcTotalCostPerAnimal(BASE);
    const table = calcSensitivityTable(costs.totalCostPerAnimal, BASE.targetMassKg);
    // Same margin column, ascending mass rows → descending price/kg
    const zeroMarginCol = table.map((row) => row.find((c) => c.marginPercent === 0)!);
    const masses = zeroMarginCol.map((c) => c.targetMass);
    const prices = zeroMarginCol.map((c) => c.pricePerKg);
    // masses should be sorted ascending
    for (let i = 1; i < masses.length; i++) {
      expect(masses[i]).toBeGreaterThan(masses[i - 1]);
      expect(prices[i]).toBeLessThan(prices[i - 1]);
    }
  });
});
