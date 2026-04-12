import { describe, it, expect } from 'vitest';
import {
  calcCostOfGain,
  categoriesForScope,
  isCogScope,
  COG_SCOPES,
  COG_SCOPE_CATEGORIES,
} from '@/lib/calculators/cost-of-gain';

describe('calcCostOfGain', () => {
  it('divides cost by kg gained when gain is positive', () => {
    const r = calcCostOfGain({ totalCost: 12000, kgGained: 400 });
    expect(r.costOfGain).toBeCloseTo(30, 6);
    expect(r.totalCost).toBe(12000);
    expect(r.kgGained).toBe(400);
  });

  it('returns null when kgGained is zero', () => {
    const r = calcCostOfGain({ totalCost: 500, kgGained: 0 });
    expect(r.costOfGain).toBeNull();
  });

  it('returns null when kgGained is negative (defensive)', () => {
    const r = calcCostOfGain({ totalCost: 500, kgGained: -10 });
    expect(r.costOfGain).toBeNull();
  });

  it('returns 0 when totalCost is 0 but gain is positive', () => {
    const r = calcCostOfGain({ totalCost: 0, kgGained: 100 });
    expect(r.costOfGain).toBe(0);
  });

  it('handles fractional inputs without drift', () => {
    const r = calcCostOfGain({ totalCost: 1234.56, kgGained: 78.9 });
    expect(r.costOfGain).toBeCloseTo(1234.56 / 78.9, 6);
  });
});

describe('categoriesForScope', () => {
  it('returns null for "all" (no filter)', () => {
    expect(categoriesForScope('all')).toBeNull();
  });

  it('returns Feed + Vet categories for "feed_vet"', () => {
    expect(categoriesForScope('feed_vet')).toEqual([
      'Feed/Supplements',
      'Medication/Vet',
    ]);
  });
});

describe('isCogScope', () => {
  it('accepts known scopes', () => {
    expect(isCogScope('all')).toBe(true);
    expect(isCogScope('feed_vet')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isCogScope('feed')).toBe(false);
    expect(isCogScope('')).toBe(false);
    expect(isCogScope(null)).toBe(false);
    expect(isCogScope(undefined)).toBe(false);
  });
});

describe('COG_SCOPES registry', () => {
  it('enumerates every key in COG_SCOPE_CATEGORIES', () => {
    const keys = Object.keys(COG_SCOPE_CATEGORIES).sort();
    expect([...COG_SCOPES].sort()).toEqual(keys);
  });
});
