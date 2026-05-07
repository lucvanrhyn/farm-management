// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  reconcileCounts,
  reconcileFromArrays,
} from '../../../lib/reconcile/counts';

/**
 * Unit-level coverage for the shared reconcile module. The integration test
 * in `__tests__/integration/count-reconciliation.test.ts` continues to pin
 * the actual PRD #128 invariant (874 / 19 numbers etc.); this file targets
 * the module-level contract: pure function, expected shape, defensive
 * handling of nullish camp counts.
 */
describe('reconcileCounts — pure-arithmetic contract', () => {
  it('returns ok=true with divergence=0 when the two sources agree', () => {
    const r = reconcileCounts({
      farmAnimalCount: 100,
      campAnimalCounts: [40, 35, 25],
    });
    expect(r).toEqual({
      farmCount: 100,
      summedCount: 100,
      divergence: 0,
      ok: true,
      campCount: 3,
    });
  });

  it('returns negative divergence when camps under-report', () => {
    // Farm-truth = 100 animals, camps total only 80 → `summed - farm = -20`.
    // Signed direction matters: this tells ops "20 animals are not assigned
    // to any camp" vs the opposite.
    const r = reconcileCounts({
      farmAnimalCount: 100,
      campAnimalCounts: [40, 40],
    });
    expect(r.divergence).toBe(-20);
    expect(r.ok).toBe(false);
  });

  it('returns positive divergence when camps over-report (the PRD #128 inverse)', () => {
    // Farm-truth = 0 (the C2 admin overview symptom), camps total 136.
    // Drift is +136 — the shared module surfaces the magnitude AND direction.
    const r = reconcileCounts({
      farmAnimalCount: 0,
      campAnimalCounts: [71, 65],
    });
    expect(r.divergence).toBe(136);
    expect(r.ok).toBe(false);
    expect(r.campCount).toBe(2);
  });

  it('handles an empty tenant cleanly', () => {
    const r = reconcileCounts({ farmAnimalCount: 0, campAnimalCounts: [] });
    expect(r).toEqual({
      farmCount: 0,
      summedCount: 0,
      divergence: 0,
      ok: true,
      campCount: 0,
    });
  });

  it('treats null/undefined per-camp counts as zero (defensive)', () => {
    // Some legacy fixtures or API responses ship without animal_count when
    // the camp is empty. The reducer guards with `?? 0` so a sparse array
    // is treated as a zero-count camp rather than NaN.
    const r = reconcileCounts({
      farmAnimalCount: 0,
      // @ts-expect-error - exercising the runtime nullish path
      campAnimalCounts: [null, undefined, 0],
    });
    expect(r.summedCount).toBe(0);
    expect(r.divergence).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.campCount).toBe(3);
  });
});

describe('reconcileFromArrays — sugar entry point', () => {
  it('uses animals.length as the farm count and maps camps.animal_count', () => {
    const animals = new Array(874).fill({}); // length is what matters
    const camps = [
      { animal_count: 71 },
      { animal_count: 65 },
      { animal_count: 738 },
    ];
    const r = reconcileFromArrays(animals, camps);
    expect(r.farmCount).toBe(874);
    expect(r.summedCount).toBe(874);
    expect(r.ok).toBe(true);
    expect(r.campCount).toBe(3);
  });

  it('exposes the divergence on real-shape input (PRD bug repro)', () => {
    // Replays the C2 stress-test signature: admin says 0 / 0, camps array
    // present and non-empty.
    const animals: unknown[] = [];
    const camps = [{ animal_count: 71 }, { animal_count: 65 }];
    const r = reconcileFromArrays(animals, camps);
    expect(r.farmCount).toBe(0);
    expect(r.summedCount).toBe(136);
    expect(r.divergence).toBe(136);
    expect(r.ok).toBe(false);
  });

  it('treats missing animal_count keys as zero (defensive)', () => {
    const r = reconcileFromArrays([], [{}, { animal_count: 5 }, { animal_count: null }]);
    expect(r.summedCount).toBe(5);
    expect(r.campCount).toBe(3);
  });
});
