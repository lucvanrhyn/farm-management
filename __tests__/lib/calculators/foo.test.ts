import { describe, expect, it } from 'vitest';
import {
  classifyFooStatus,
  calcCampFoo,
  calcFarmFooSummary,
  calcFooTrendSlope,
  FOO_CRITICAL_KG_DM,
  FOO_LOW_KG_DM,
  FOO_GOOD_KG_DM,
  FOO_STALE_DAYS,
  type FooStatus,
  type CampFooInput,
  type CampFooResult,
} from '@/lib/calculators/foo';

// ── classifyFooStatus ─────────────────────────────────────────────────────────

describe('classifyFooStatus', () => {
  it('returns unknown for null', () => {
    expect(classifyFooStatus(null)).toBe('unknown');
  });

  it('returns critical below 500', () => {
    expect(classifyFooStatus(0)).toBe('critical');
    expect(classifyFooStatus(499)).toBe('critical');
  });

  it('returns critical at exactly 0', () => {
    expect(classifyFooStatus(0)).toBe('critical');
  });

  it('returns low at 500 up to 999', () => {
    expect(classifyFooStatus(500)).toBe('low');
    expect(classifyFooStatus(999)).toBe('low');
  });

  it('returns adequate at 1000 up to 1999', () => {
    expect(classifyFooStatus(1000)).toBe('adequate');
    expect(classifyFooStatus(1999)).toBe('adequate');
  });

  it('returns good at 2000 and above', () => {
    expect(classifyFooStatus(2000)).toBe('good');
    expect(classifyFooStatus(5000)).toBe('good');
  });
});

// ── calcCampFoo ───────────────────────────────────────────────────────────────

describe('calcCampFoo', () => {
  const now = new Date('2026-04-12T12:00:00Z');

  it('returns null fields when kgDmPerHa is null', () => {
    const input: CampFooInput = {
      kgDmPerHa: null,
      useFactor: 0.35,
      sizeHectares: 100,
      recordedAt: '2026-04-01T00:00:00Z',
    };
    const result = calcCampFoo(input, now);
    expect(result.kgDmPerHa).toBeNull();
    expect(result.effectiveFooKg).toBeNull();
    expect(result.capacityLsuDays).toBeNull();
    expect(result.status).toBe('unknown');
  });

  it('returns null fields when sizeHectares is null', () => {
    const input: CampFooInput = {
      kgDmPerHa: 2000,
      useFactor: 0.35,
      sizeHectares: null,
      recordedAt: '2026-04-01T00:00:00Z',
    };
    const result = calcCampFoo(input, now);
    expect(result.effectiveFooKg).toBeNull();
    expect(result.capacityLsuDays).toBeNull();
    // status still based on kgDmPerHa
    expect(result.status).toBe('good');
  });

  it('computes correct effectiveFoo and capacityLsuDays', () => {
    const input: CampFooInput = {
      kgDmPerHa: 2000,
      useFactor: 0.35,
      sizeHectares: 100,
      recordedAt: '2026-04-01T00:00:00Z',
    };
    const result = calcCampFoo(input, now);
    // effectiveFoo = 2000 * 0.35 * 100 = 70,000 kg
    expect(result.effectiveFooKg).toBe(70000);
    // capacityLsuDays = 70000 / 10 = 7000
    expect(result.capacityLsuDays).toBe(7000);
    expect(result.status).toBe('good');
  });

  it('marks reading as stale when older than 30 days', () => {
    const input: CampFooInput = {
      kgDmPerHa: 1500,
      useFactor: 0.35,
      sizeHectares: 50,
      recordedAt: '2026-03-01T00:00:00Z', // 42 days before now
    };
    const result = calcCampFoo(input, now);
    expect(result.isStale).toBe(true);
    expect(result.daysSinceReading).toBe(42);
  });

  it('marks reading as fresh when within 30 days', () => {
    const input: CampFooInput = {
      kgDmPerHa: 1500,
      useFactor: 0.35,
      sizeHectares: 50,
      recordedAt: '2026-04-10T00:00:00Z', // 2 days before now
    };
    const result = calcCampFoo(input, now);
    expect(result.isStale).toBe(false);
    expect(result.daysSinceReading).toBe(2);
  });

  it('returns null daysSinceReading when recordedAt is null', () => {
    const input: CampFooInput = {
      kgDmPerHa: null,
      useFactor: null,
      sizeHectares: 50,
      recordedAt: null,
    };
    const result = calcCampFoo(input, now);
    expect(result.daysSinceReading).toBeNull();
    expect(result.isStale).toBe(true); // no reading = stale
  });

  it('handles zero sizeHectares gracefully', () => {
    const input: CampFooInput = {
      kgDmPerHa: 2000,
      useFactor: 0.35,
      sizeHectares: 0,
      recordedAt: '2026-04-10T00:00:00Z',
    };
    const result = calcCampFoo(input, now);
    expect(result.effectiveFooKg).toBeNull();
    expect(result.capacityLsuDays).toBeNull();
  });
});

// ── calcFarmFooSummary ────────────────────────────────────────────────────────

describe('calcFarmFooSummary', () => {
  it('aggregates counts by status bucket', () => {
    const camps: readonly CampFooResult[] = [
      { kgDmPerHa: 300, effectiveFooKg: 10500, capacityLsuDays: 1050, status: 'critical', daysSinceReading: 5, isStale: false },
      { kgDmPerHa: 800, effectiveFooKg: 28000, capacityLsuDays: 2800, status: 'low', daysSinceReading: 10, isStale: false },
      { kgDmPerHa: 1500, effectiveFooKg: 52500, capacityLsuDays: 5250, status: 'adequate', daysSinceReading: 20, isStale: false },
      { kgDmPerHa: 2500, effectiveFooKg: 87500, capacityLsuDays: 8750, status: 'good', daysSinceReading: 3, isStale: false },
      { kgDmPerHa: null, effectiveFooKg: null, capacityLsuDays: null, status: 'unknown', daysSinceReading: null, isStale: true },
    ];
    const summary = calcFarmFooSummary(camps);
    expect(summary.campsCritical).toBe(1);
    expect(summary.campsLow).toBe(1);
    expect(summary.campsAdequate).toBe(1);
    expect(summary.campsGood).toBe(1);
    expect(summary.campsNoData).toBe(1);
  });

  it('computes total pasture inventory from effectiveFooKg', () => {
    const camps: readonly CampFooResult[] = [
      { kgDmPerHa: 2000, effectiveFooKg: 70000, capacityLsuDays: 7000, status: 'good', daysSinceReading: 1, isStale: false },
      { kgDmPerHa: 1000, effectiveFooKg: 35000, capacityLsuDays: 3500, status: 'adequate', daysSinceReading: 1, isStale: false },
    ];
    const summary = calcFarmFooSummary(camps);
    expect(summary.totalPastureInventoryKg).toBe(105000);
    expect(summary.totalCapacityLsuDays).toBe(10500);
  });

  it('averages FOO only across camps with data', () => {
    const camps: readonly CampFooResult[] = [
      { kgDmPerHa: 2000, effectiveFooKg: 70000, capacityLsuDays: 7000, status: 'good', daysSinceReading: 1, isStale: false },
      { kgDmPerHa: 1000, effectiveFooKg: 35000, capacityLsuDays: 3500, status: 'adequate', daysSinceReading: 1, isStale: false },
      { kgDmPerHa: null, effectiveFooKg: null, capacityLsuDays: null, status: 'unknown', daysSinceReading: null, isStale: true },
    ];
    const summary = calcFarmFooSummary(camps);
    expect(summary.averageFooKgDmPerHa).toBe(1500);
  });

  it('returns null average when no camps have data', () => {
    const camps: readonly CampFooResult[] = [
      { kgDmPerHa: null, effectiveFooKg: null, capacityLsuDays: null, status: 'unknown', daysSinceReading: null, isStale: true },
    ];
    const summary = calcFarmFooSummary(camps);
    expect(summary.averageFooKgDmPerHa).toBeNull();
    expect(summary.totalPastureInventoryKg).toBe(0);
  });

  it('counts stale readings', () => {
    const camps: readonly CampFooResult[] = [
      { kgDmPerHa: 2000, effectiveFooKg: 70000, capacityLsuDays: 7000, status: 'good', daysSinceReading: 35, isStale: true },
      { kgDmPerHa: 1000, effectiveFooKg: 35000, capacityLsuDays: 3500, status: 'adequate', daysSinceReading: 5, isStale: false },
    ];
    const summary = calcFarmFooSummary(camps);
    expect(summary.campsStaleReading).toBe(1);
  });

  it('handles empty array', () => {
    const summary = calcFarmFooSummary([]);
    expect(summary.campsCritical).toBe(0);
    expect(summary.totalPastureInventoryKg).toBe(0);
    expect(summary.averageFooKgDmPerHa).toBeNull();
  });
});

// ── calcFooTrendSlope ─────────────────────────────────────────────────────────

describe('calcFooTrendSlope', () => {
  it('returns 0 for fewer than 2 points', () => {
    expect(calcFooTrendSlope([])).toBe(0);
    expect(calcFooTrendSlope([{ date: '2026-01-01', kgDmPerHa: 1500 }])).toBe(0);
  });

  it('returns positive slope for improving FOO', () => {
    const points = [
      { date: '2026-01-01', kgDmPerHa: 1000 },
      { date: '2026-04-01', kgDmPerHa: 1600 },
    ];
    const slope = calcFooTrendSlope(points);
    expect(slope).toBeGreaterThan(0);
  });

  it('returns negative slope for declining FOO', () => {
    const points = [
      { date: '2026-01-01', kgDmPerHa: 2000 },
      { date: '2026-04-01', kgDmPerHa: 1000 },
    ];
    const slope = calcFooTrendSlope(points);
    expect(slope).toBeLessThan(0);
  });

  it('returns 0 for flat series', () => {
    const points = [
      { date: '2026-01-01', kgDmPerHa: 1500 },
      { date: '2026-04-01', kgDmPerHa: 1500 },
    ];
    expect(calcFooTrendSlope(points)).toBe(0);
  });

  it('handles unsorted input', () => {
    const points = [
      { date: '2026-04-01', kgDmPerHa: 1600 },
      { date: '2026-01-01', kgDmPerHa: 1000 },
    ];
    const slope = calcFooTrendSlope(points);
    expect(slope).toBeGreaterThan(0);
  });
});
