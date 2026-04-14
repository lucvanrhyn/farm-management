import { describe, it, expect } from 'vitest';
import { computeFarmLsuFromCounts } from '../farm-lsu';

describe('computeFarmLsuFromCounts', () => {
  it('sums species-weighted counts', () => {
    const counts = { cattle: 100, sheep: 500 };
    const weights = { cattle: 1.0, sheep: 0.15 };
    // 100*1 + 500*0.15 = 175
    expect(computeFarmLsuFromCounts(counts, weights)).toBe(175);
  });
  it('ignores species with no weight', () => {
    const counts = { cattle: 100, alien: 50 };
    const weights = { cattle: 1.0 };
    expect(computeFarmLsuFromCounts(counts, weights)).toBe(100);
  });
  it('rounds to nearest integer', () => {
    const counts = { sheep: 33 };
    const weights = { sheep: 0.15 };
    // 33 * 0.15 = 4.95 → 5
    expect(computeFarmLsuFromCounts(counts, weights)).toBe(5);
  });
  it('returns 0 for empty counts', () => {
    expect(computeFarmLsuFromCounts({}, { cattle: 1 })).toBe(0);
  });
  it('handles the mixed 350 LSU anchor from the plan', () => {
    // 200 cattle + 1000 sheep = 200*1 + 1000*0.15 = 350 LSU (Advanced R6,500)
    const counts = { cattle: 200, sheep: 1000 };
    const weights = { cattle: 1.0, sheep: 0.15 };
    expect(computeFarmLsuFromCounts(counts, weights)).toBe(350);
  });
  it('ignores zero-weight species', () => {
    const counts = { cattle: 100, pest: 1000 };
    const weights = { cattle: 1.0, pest: 0 };
    expect(computeFarmLsuFromCounts(counts, weights)).toBe(100);
  });
});
