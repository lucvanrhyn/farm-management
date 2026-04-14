import { describe, expect, it } from 'vitest';
import {
  classifyFeedOnOfferStatus,
  calcCampFeedOnOffer,
  calcFarmFeedOnOfferSummary,
  calcFeedOnOfferTrendSlope,
  FEED_ON_OFFER_CRITICAL_KG_DM,
  FEED_ON_OFFER_LOW_KG_DM,
  FEED_ON_OFFER_GOOD_KG_DM,
  FEED_ON_OFFER_STALE_DAYS,
  type FeedOnOfferStatus,
  type CampFeedOnOfferInput,
  type CampFeedOnOfferResult,
} from '@/lib/calculators/feed-on-offer';

// ── classifyFeedOnOfferStatus ────────────────────────────────────────────────

describe('classifyFeedOnOfferStatus', () => {
  it('returns unknown for null', () => {
    expect(classifyFeedOnOfferStatus(null)).toBe('unknown');
  });

  it('returns critical below 500', () => {
    expect(classifyFeedOnOfferStatus(0)).toBe('critical');
    expect(classifyFeedOnOfferStatus(499)).toBe('critical');
  });

  it('returns critical at exactly 0', () => {
    expect(classifyFeedOnOfferStatus(0)).toBe('critical');
  });

  it('returns low at 500 up to 999', () => {
    expect(classifyFeedOnOfferStatus(500)).toBe('low');
    expect(classifyFeedOnOfferStatus(999)).toBe('low');
  });

  it('returns adequate at 1000 up to 1999', () => {
    expect(classifyFeedOnOfferStatus(1000)).toBe('adequate');
    expect(classifyFeedOnOfferStatus(1999)).toBe('adequate');
  });

  it('returns good at 2000 and above', () => {
    expect(classifyFeedOnOfferStatus(2000)).toBe('good');
    expect(classifyFeedOnOfferStatus(5000)).toBe('good');
  });
});

// ── calcCampFeedOnOffer ──────────────────────────────────────────────────────

describe('calcCampFeedOnOffer', () => {
  const now = new Date('2026-04-12T12:00:00Z');

  it('returns null fields when kgDmPerHa is null', () => {
    const input: CampFeedOnOfferInput = {
      kgDmPerHa: null,
      useFactor: 0.35,
      sizeHectares: 100,
      recordedAt: '2026-04-01T00:00:00Z',
    };
    const result = calcCampFeedOnOffer(input, now);
    expect(result.kgDmPerHa).toBeNull();
    expect(result.effectiveFeedOnOfferKg).toBeNull();
    expect(result.capacityLsuDays).toBeNull();
    expect(result.status).toBe('unknown');
  });

  it('returns null fields when sizeHectares is null', () => {
    const input: CampFeedOnOfferInput = {
      kgDmPerHa: 2000,
      useFactor: 0.35,
      sizeHectares: null,
      recordedAt: '2026-04-01T00:00:00Z',
    };
    const result = calcCampFeedOnOffer(input, now);
    expect(result.effectiveFeedOnOfferKg).toBeNull();
    expect(result.capacityLsuDays).toBeNull();
    // status still based on kgDmPerHa
    expect(result.status).toBe('good');
  });

  it('computes correct effective inventory and capacityLsuDays', () => {
    const input: CampFeedOnOfferInput = {
      kgDmPerHa: 2000,
      useFactor: 0.35,
      sizeHectares: 100,
      recordedAt: '2026-04-01T00:00:00Z',
    };
    const result = calcCampFeedOnOffer(input, now);
    // effective = 2000 * 0.35 * 100 = 70,000 kg
    expect(result.effectiveFeedOnOfferKg).toBe(70000);
    // capacityLsuDays = 70000 / 10 = 7000
    expect(result.capacityLsuDays).toBe(7000);
    expect(result.status).toBe('good');
  });

  it('marks reading as stale when older than 30 days', () => {
    const input: CampFeedOnOfferInput = {
      kgDmPerHa: 1500,
      useFactor: 0.35,
      sizeHectares: 50,
      recordedAt: '2026-03-01T00:00:00Z', // 42 days before now
    };
    const result = calcCampFeedOnOffer(input, now);
    expect(result.isStale).toBe(true);
    expect(result.daysSinceReading).toBe(42);
  });

  it('marks reading as fresh when within 30 days', () => {
    const input: CampFeedOnOfferInput = {
      kgDmPerHa: 1500,
      useFactor: 0.35,
      sizeHectares: 50,
      recordedAt: '2026-04-10T00:00:00Z', // 2 days before now
    };
    const result = calcCampFeedOnOffer(input, now);
    expect(result.isStale).toBe(false);
    expect(result.daysSinceReading).toBe(2);
  });

  it('returns null daysSinceReading when recordedAt is null', () => {
    const input: CampFeedOnOfferInput = {
      kgDmPerHa: null,
      useFactor: null,
      sizeHectares: 50,
      recordedAt: null,
    };
    const result = calcCampFeedOnOffer(input, now);
    expect(result.daysSinceReading).toBeNull();
    expect(result.isStale).toBe(true); // no reading = stale
  });

  it('handles zero sizeHectares gracefully', () => {
    const input: CampFeedOnOfferInput = {
      kgDmPerHa: 2000,
      useFactor: 0.35,
      sizeHectares: 0,
      recordedAt: '2026-04-10T00:00:00Z',
    };
    const result = calcCampFeedOnOffer(input, now);
    expect(result.effectiveFeedOnOfferKg).toBeNull();
    expect(result.capacityLsuDays).toBeNull();
  });
});

// ── calcFarmFeedOnOfferSummary ───────────────────────────────────────────────

describe('calcFarmFeedOnOfferSummary', () => {
  it('aggregates counts by status bucket', () => {
    const camps: readonly CampFeedOnOfferResult[] = [
      { kgDmPerHa: 300, effectiveFeedOnOfferKg: 10500, capacityLsuDays: 1050, status: 'critical', daysSinceReading: 5, isStale: false },
      { kgDmPerHa: 800, effectiveFeedOnOfferKg: 28000, capacityLsuDays: 2800, status: 'low', daysSinceReading: 10, isStale: false },
      { kgDmPerHa: 1500, effectiveFeedOnOfferKg: 52500, capacityLsuDays: 5250, status: 'adequate', daysSinceReading: 20, isStale: false },
      { kgDmPerHa: 2500, effectiveFeedOnOfferKg: 87500, capacityLsuDays: 8750, status: 'good', daysSinceReading: 3, isStale: false },
      { kgDmPerHa: null, effectiveFeedOnOfferKg: null, capacityLsuDays: null, status: 'unknown', daysSinceReading: null, isStale: true },
    ];
    const summary = calcFarmFeedOnOfferSummary(camps);
    expect(summary.campsCritical).toBe(1);
    expect(summary.campsLow).toBe(1);
    expect(summary.campsAdequate).toBe(1);
    expect(summary.campsGood).toBe(1);
    expect(summary.campsNoData).toBe(1);
  });

  it('computes total pasture inventory from effectiveFeedOnOfferKg', () => {
    const camps: readonly CampFeedOnOfferResult[] = [
      { kgDmPerHa: 2000, effectiveFeedOnOfferKg: 70000, capacityLsuDays: 7000, status: 'good', daysSinceReading: 1, isStale: false },
      { kgDmPerHa: 1000, effectiveFeedOnOfferKg: 35000, capacityLsuDays: 3500, status: 'adequate', daysSinceReading: 1, isStale: false },
    ];
    const summary = calcFarmFeedOnOfferSummary(camps);
    expect(summary.totalPastureInventoryKg).toBe(105000);
    expect(summary.totalCapacityLsuDays).toBe(10500);
  });

  it('averages Feed on Offer only across camps with data', () => {
    const camps: readonly CampFeedOnOfferResult[] = [
      { kgDmPerHa: 2000, effectiveFeedOnOfferKg: 70000, capacityLsuDays: 7000, status: 'good', daysSinceReading: 1, isStale: false },
      { kgDmPerHa: 1000, effectiveFeedOnOfferKg: 35000, capacityLsuDays: 3500, status: 'adequate', daysSinceReading: 1, isStale: false },
      { kgDmPerHa: null, effectiveFeedOnOfferKg: null, capacityLsuDays: null, status: 'unknown', daysSinceReading: null, isStale: true },
    ];
    const summary = calcFarmFeedOnOfferSummary(camps);
    expect(summary.averageFeedOnOfferKgDmPerHa).toBe(1500);
  });

  it('returns null average when no camps have data', () => {
    const camps: readonly CampFeedOnOfferResult[] = [
      { kgDmPerHa: null, effectiveFeedOnOfferKg: null, capacityLsuDays: null, status: 'unknown', daysSinceReading: null, isStale: true },
    ];
    const summary = calcFarmFeedOnOfferSummary(camps);
    expect(summary.averageFeedOnOfferKgDmPerHa).toBeNull();
    expect(summary.totalPastureInventoryKg).toBe(0);
  });

  it('counts stale readings', () => {
    const camps: readonly CampFeedOnOfferResult[] = [
      { kgDmPerHa: 2000, effectiveFeedOnOfferKg: 70000, capacityLsuDays: 7000, status: 'good', daysSinceReading: 35, isStale: true },
      { kgDmPerHa: 1000, effectiveFeedOnOfferKg: 35000, capacityLsuDays: 3500, status: 'adequate', daysSinceReading: 5, isStale: false },
    ];
    const summary = calcFarmFeedOnOfferSummary(camps);
    expect(summary.campsStaleReading).toBe(1);
  });

  it('handles empty array', () => {
    const summary = calcFarmFeedOnOfferSummary([]);
    expect(summary.campsCritical).toBe(0);
    expect(summary.totalPastureInventoryKg).toBe(0);
    expect(summary.averageFeedOnOfferKgDmPerHa).toBeNull();
  });
});

// ── calcFeedOnOfferTrendSlope ────────────────────────────────────────────────

describe('calcFeedOnOfferTrendSlope', () => {
  it('returns 0 for fewer than 2 points', () => {
    expect(calcFeedOnOfferTrendSlope([])).toBe(0);
    expect(calcFeedOnOfferTrendSlope([{ date: '2026-01-01', kgDmPerHa: 1500 }])).toBe(0);
  });

  it('returns positive slope for improving Feed on Offer', () => {
    const points = [
      { date: '2026-01-01', kgDmPerHa: 1000 },
      { date: '2026-04-01', kgDmPerHa: 1600 },
    ];
    const slope = calcFeedOnOfferTrendSlope(points);
    expect(slope).toBeGreaterThan(0);
  });

  it('returns negative slope for declining Feed on Offer', () => {
    const points = [
      { date: '2026-01-01', kgDmPerHa: 2000 },
      { date: '2026-04-01', kgDmPerHa: 1000 },
    ];
    const slope = calcFeedOnOfferTrendSlope(points);
    expect(slope).toBeLessThan(0);
  });

  it('returns 0 for flat series', () => {
    const points = [
      { date: '2026-01-01', kgDmPerHa: 1500 },
      { date: '2026-04-01', kgDmPerHa: 1500 },
    ];
    expect(calcFeedOnOfferTrendSlope(points)).toBe(0);
  });

  it('handles unsorted input', () => {
    const points = [
      { date: '2026-04-01', kgDmPerHa: 1600 },
      { date: '2026-01-01', kgDmPerHa: 1000 },
    ];
    const slope = calcFeedOnOfferTrendSlope(points);
    expect(slope).toBeGreaterThan(0);
  });
});
