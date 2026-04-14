import { describe, it, expect } from 'vitest';
import { quoteTier, computeAnnual, computeMonthlyFromAnnual, formatZar } from '../calculator';

describe('computeAnnual', () => {
  it('basic: 100 LSU → R1,875', () => {
    expect(computeAnnual('basic', 100)).toBe(1875);
  });
  it('advanced: 100 LSU → R4,000', () => {
    expect(computeAnnual('advanced', 100)).toBe(4000);
  });
  it('basic: 800 LSU → R2,400 (anchor)', () => {
    expect(computeAnnual('basic', 800)).toBe(2400);
  });
  it('advanced: 800 LSU → R11,000 (anchor)', () => {
    expect(computeAnnual('advanced', 800)).toBe(11000);
  });
  it('basic: 0 LSU → R1,800 (base only)', () => {
    expect(computeAnnual('basic', 0)).toBe(1800);
  });
  it('basic: 10_000 LSU → R9,300 (scales linearly)', () => {
    expect(computeAnnual('basic', 10000)).toBe(9300);
  });
  it('advanced: 350 mixed LSU → R6,500', () => {
    expect(computeAnnual('advanced', 350)).toBe(6500);
  });
});

describe('computeMonthlyFromAnnual', () => {
  it('applies 20% premium and divides by 12', () => {
    // 2400 * 1.2 / 12 = 240
    expect(computeMonthlyFromAnnual(2400)).toBe(240);
  });
  it('rounds to nearest rand', () => {
    // 4000 * 1.2 / 12 = 400
    expect(computeMonthlyFromAnnual(4000)).toBe(400);
  });
  it('handles 0', () => {
    expect(computeMonthlyFromAnnual(0)).toBe(0);
  });
});

describe('quoteTier', () => {
  it('returns annual, monthly, and formatted strings for basic', () => {
    const q = quoteTier('basic', 800);
    expect(q.annualZar).toBe(2400);
    expect(q.monthlyZar).toBe(240);
    expect(q.annualFormatted).toBe('R2,400');
    expect(q.monthlyFormatted).toBe('R240');
  });
  it('rejects negative LSU', () => {
    expect(() => quoteTier('basic', -1)).toThrow(/non-negative/);
  });
  it('rejects non-integer LSU', () => {
    expect(() => quoteTier('basic', 100.5)).toThrow(/integer/);
  });
});

describe('formatZar', () => {
  it('formats with thousand separators', () => {
    expect(formatZar(11000)).toBe('R11,000');
  });
  it('handles 0', () => {
    expect(formatZar(0)).toBe('R0');
  });
});
