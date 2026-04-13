/**
 * Tests for lib/calculators/spi.ts
 *
 * SPI = Standard Precipitation Index (WMO standard drought metric)
 * v1 uses Z-score, not gamma fit. See spi.ts header for rationale.
 */

import { describe, it, expect } from 'vitest';
import {
  calcSpi,
  severityFromSpi,
  aggregateMonthlyTotals,
  rollingWindowSum,
  computeClimatologyByMonth,
  type MonthClimatology,
  type SpiSeverity,
} from '../spi';

// ── calcSpi ──────────────────────────────────────────────────────────────────

describe('calcSpi', () => {
  it('returns 0 when rainfall equals the mean', () => {
    const c: MonthClimatology = { mean: 50, stdDev: 10 };
    expect(calcSpi(50, c)).toBe(0);
  });

  it('returns positive SPI when rainfall is above mean', () => {
    const c: MonthClimatology = { mean: 50, stdDev: 10 };
    expect(calcSpi(60, c)).toBeCloseTo(1.0, 5);
  });

  it('returns negative SPI when rainfall is below mean', () => {
    const c: MonthClimatology = { mean: 50, stdDev: 10 };
    expect(calcSpi(40, c)).toBeCloseTo(-1.0, 5);
  });

  it('identity: when mean=0 and stdDev=1, SPI equals the input', () => {
    const c: MonthClimatology = { mean: 0, stdDev: 1 };
    expect(calcSpi(-1.5, c)).toBeCloseTo(-1.5, 5);
    expect(calcSpi(2.0, c)).toBeCloseTo(2.0, 5);
  });

  it('handles zero rainfall correctly', () => {
    const c: MonthClimatology = { mean: 30, stdDev: 15 };
    expect(calcSpi(0, c)).toBeCloseTo(-2.0, 5);
  });

  it('returns 0 when stdDev is 0 (degenerate climatology)', () => {
    const c: MonthClimatology = { mean: 50, stdDev: 0 };
    expect(calcSpi(60, c)).toBe(0);
  });
});

// ── severityFromSpi ───────────────────────────────────────────────────────────

describe('severityFromSpi', () => {
  // WMO thresholds: ≤−2 extreme-drought, ≤−1.5 severe-drought, ≤−1 moderate-drought,
  //                 ≤−0.5 mild-dry, (−0.5, 0.5) near-normal, ≥0.5 mild-wet,
  //                 ≥1 moderate-wet, ≥1.5 severe-wet, ≥2 extreme-wet

  it('identifies extreme-drought at -2.0', () => {
    expect(severityFromSpi(-2.0)).toBe<SpiSeverity>('extreme-drought');
  });

  it('identifies extreme-drought below -2', () => {
    expect(severityFromSpi(-3.1)).toBe<SpiSeverity>('extreme-drought');
  });

  it('identifies severe-drought at -1.5', () => {
    expect(severityFromSpi(-1.5)).toBe<SpiSeverity>('severe-drought');
  });

  it('identifies severe-drought between -1.99 and -1.5', () => {
    expect(severityFromSpi(-1.8)).toBe<SpiSeverity>('severe-drought');
  });

  it('identifies moderate-drought at -1.0', () => {
    expect(severityFromSpi(-1.0)).toBe<SpiSeverity>('moderate-drought');
  });

  it('identifies moderate-drought between -1.49 and -1.0', () => {
    expect(severityFromSpi(-1.2)).toBe<SpiSeverity>('moderate-drought');
  });

  it('identifies mild-dry at -0.5', () => {
    expect(severityFromSpi(-0.5)).toBe<SpiSeverity>('mild-dry');
  });

  it('identifies mild-dry between -0.99 and -0.5', () => {
    expect(severityFromSpi(-0.7)).toBe<SpiSeverity>('mild-dry');
  });

  it('identifies near-normal at 0', () => {
    expect(severityFromSpi(0)).toBe<SpiSeverity>('near-normal');
  });

  it('identifies near-normal between -0.49 and 0.49', () => {
    expect(severityFromSpi(0.3)).toBe<SpiSeverity>('near-normal');
    expect(severityFromSpi(-0.3)).toBe<SpiSeverity>('near-normal');
  });

  it('identifies mild-wet at 0.5', () => {
    expect(severityFromSpi(0.5)).toBe<SpiSeverity>('mild-wet');
  });

  it('identifies moderate-wet at 1.0', () => {
    expect(severityFromSpi(1.0)).toBe<SpiSeverity>('moderate-wet');
  });

  it('identifies severe-wet at 1.5', () => {
    expect(severityFromSpi(1.5)).toBe<SpiSeverity>('severe-wet');
  });

  it('identifies extreme-wet at 2.0 and above', () => {
    expect(severityFromSpi(2.0)).toBe<SpiSeverity>('extreme-wet');
    expect(severityFromSpi(3.5)).toBe<SpiSeverity>('extreme-wet');
  });
});

// ── aggregateMonthlyTotals ────────────────────────────────────────────────────

describe('aggregateMonthlyTotals', () => {
  it('returns empty map for empty input', () => {
    const result = aggregateMonthlyTotals([]);
    expect(result.size).toBe(0);
  });

  it('sums multiple records within the same month', () => {
    const records = [
      { date: '2024-01-05', rainfallMm: 10 },
      { date: '2024-01-20', rainfallMm: 15 },
      { date: '2024-01-31', rainfallMm: 5 },
    ];
    const result = aggregateMonthlyTotals(records);
    expect(result.get('2024-01')).toBe(30);
  });

  it('keeps separate months independent', () => {
    const records = [
      { date: '2024-01-10', rainfallMm: 20 },
      { date: '2024-02-14', rainfallMm: 35 },
    ];
    const result = aggregateMonthlyTotals(records);
    expect(result.get('2024-01')).toBe(20);
    expect(result.get('2024-02')).toBe(35);
  });

  it('handles out-of-order dates', () => {
    const records = [
      { date: '2024-03-15', rainfallMm: 12 },
      { date: '2024-01-01', rainfallMm: 8 },
      { date: '2024-03-01', rainfallMm: 18 },
    ];
    const result = aggregateMonthlyTotals(records);
    expect(result.get('2024-01')).toBe(8);
    expect(result.get('2024-03')).toBe(30);
  });

  it('handles zero rainfall records correctly', () => {
    const records = [
      { date: '2024-06-01', rainfallMm: 0 },
      { date: '2024-06-15', rainfallMm: 5 },
    ];
    const result = aggregateMonthlyTotals(records);
    expect(result.get('2024-06')).toBe(5);
  });
});

// ── rollingWindowSum ──────────────────────────────────────────────────────────

describe('rollingWindowSum', () => {
  const monthly: Map<string, number> = new Map([
    ['2024-01', 10],
    ['2024-02', 20],
    ['2024-03', 30],
    ['2024-04', 40],
    ['2024-05', 50],
    ['2024-06', 60],
    ['2024-07', 70],
    ['2024-08', 80],
    ['2024-09', 90],
    ['2024-10', 100],
    ['2024-11', 110],
    ['2024-12', 120],
    ['2025-01', 15],
  ]);

  it('SPI-3: sums the 3 months ending at anchor (inclusive)', () => {
    // anchor = 2024-03, window 3 → Jan + Feb + Mar = 10+20+30 = 60
    expect(rollingWindowSum(monthly, '2024-03', 3)).toBe(60);
  });

  it('SPI-6: sums 6 months ending at anchor', () => {
    // anchor = 2024-06 → Jan+Feb+Mar+Apr+May+Jun = 10+20+30+40+50+60 = 210
    expect(rollingWindowSum(monthly, '2024-06', 6)).toBe(210);
  });

  it('SPI-12: sums 12 months ending at anchor', () => {
    // anchor = 2024-12 → sum Jan..Dec = (10+120)*12/2 = 780
    expect(rollingWindowSum(monthly, '2024-12', 12)).toBe(780);
  });

  it('treats missing months as 0 in the window', () => {
    const sparse: Map<string, number> = new Map([
      ['2024-01', 50],
      // 2024-02 missing
      ['2024-03', 50],
    ]);
    // window 3 ending at 2024-03 → 50 + 0 + 50 = 100
    expect(rollingWindowSum(sparse, '2024-03', 3)).toBe(100);
  });

  it('crosses a year boundary correctly (window=3, anchor=2025-01)', () => {
    // 2024-11 + 2024-12 + 2025-01 = 110+120+15 = 245
    expect(rollingWindowSum(monthly, '2025-01', 3)).toBe(245);
  });

  it('returns 0 for window of size 1 when anchor month is missing', () => {
    expect(rollingWindowSum(monthly, '2025-06', 1)).toBe(0);
  });
});

// ── computeClimatologyByMonth ─────────────────────────────────────────────────

describe('computeClimatologyByMonth', () => {
  // Build a synthetic 10-year history: January always 100mm, July always 10mm
  // (all other months 0 to keep arithmetic simple)
  const buildHistory = (): { date: string; precipMm: number }[] => {
    const records: { date: string; precipMm: number }[] = [];
    for (let y = 2000; y < 2010; y++) {
      records.push({ date: `${y}-01-15`, precipMm: 100 });
      records.push({ date: `${y}-07-15`, precipMm: 10 });
    }
    return records;
  };

  it('returns 12 entries for a well-populated history', () => {
    const history = buildHistory();
    const result = computeClimatologyByMonth(history);
    expect(Object.keys(result)).toHaveLength(12);
  });

  it('computes correct mean for January', () => {
    const history = buildHistory();
    const result = computeClimatologyByMonth(history);
    expect(result[1].mean).toBeCloseTo(100, 5);
  });

  it('computes correct mean for July', () => {
    const history = buildHistory();
    const result = computeClimatologyByMonth(history);
    expect(result[7].mean).toBeCloseTo(10, 5);
  });

  it('produces stdDev=0 when all values in a month are identical', () => {
    const history = buildHistory();
    const result = computeClimatologyByMonth(history);
    expect(result[1].stdDev).toBeCloseTo(0, 3);
  });

  it('computes non-zero stdDev for varying months', () => {
    // January varies between 80 and 120 over 10 years (alternating)
    const records: { date: string; precipMm: number }[] = [];
    for (let y = 2000; y < 2010; y++) {
      records.push({ date: `${y}-01-15`, precipMm: y % 2 === 0 ? 80 : 120 });
    }
    const result = computeClimatologyByMonth(records);
    expect(result[1].stdDev).toBeGreaterThan(0);
  });

  it('assigns correct month index keys (1-based)', () => {
    const history = buildHistory();
    const result = computeClimatologyByMonth(history);
    // All 12 calendar months should be keys 1..12
    for (let m = 1; m <= 12; m++) {
      expect(result[m]).toBeDefined();
    }
  });

  it('returns mean=0, stdDev=0 for months with a single zero-rainfall record', () => {
    const records = [{ date: '2000-03-01', precipMm: 0 }];
    const result = computeClimatologyByMonth(records);
    expect(result[3].mean).toBe(0);
    expect(result[3].stdDev).toBe(0);
  });
});
