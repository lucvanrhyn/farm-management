import { describe, it, expect } from 'vitest';
import { reconcileFromArrays } from '../../lib/reconcile/counts';

/**
 * PRD #128 (2026-05-06): the home screen reported `874 animals / 19 camps`
 * while the admin overview reported `0 animals / 0 camps` for the same
 * tenant in the same session. That divergence shipped past 2,297 unit tests
 * because nothing asserted the two count sources agreed.
 *
 * This test pins the invariant
 *   farm.animalCount === sum(camps.animal_count)
 *   farm.campCount   === camps.length
 * as a unit-level table assertion. If the home / admin / camps endpoints
 * ever drift apart, the assertion fires at PR time, not on prod.
 *
 * Wave/142 (2026-05-07): the inline `reconcile()` shim that used to live in
 * this file has been extracted to `lib/reconcile/counts.ts` so the same
 * arithmetic is reusable from runtime probes (synthetic-probe, post-promote
 * gates). This file now exercises the integration shape — real PRD numbers,
 * real bug repros — while the unit-level contract lives next to the module.
 */

interface FarmSummary {
  animalCount: number;
  campCount: number;
}
interface CampRow {
  camp_id: string;
  animal_count: number;
}

/**
 * Wrap the shared module to keep the test's assertion shape readable
 * (`animalsAgree`, `campsAgree`). The module returns the canonical
 * `{ farmCount, summedCount, divergence, ok, campCount }` shape; we
 * project that into the older boolean-flag form here for clarity.
 */
function reconcile(farm: FarmSummary, camps: readonly CampRow[]) {
  const animalArr = new Array(farm.animalCount).fill({});
  const r = reconcileFromArrays(animalArr, camps);
  return {
    animalsAgree: r.ok,
    campsAgree: farm.campCount === camps.length,
    summed: r.summedCount,
  };
}

describe('count reconciliation invariant — PRD #128', () => {
  it('agrees on a healthy multi-camp tenant', () => {
    const farm = { animalCount: 874, campCount: 19 };
    const camps: CampRow[] = [
      { camp_id: 'A', animal_count: 71 },
      { camp_id: 'B', animal_count: 65 },
      { camp_id: 'B1', animal_count: 17 },
      { camp_id: 'Uithoek', animal_count: 45 },
      { camp_id: 'C', animal_count: 60 },
      { camp_id: 'D', animal_count: 90 },
      { camp_id: 'E', animal_count: 40 },
      { camp_id: 'F', animal_count: 25 },
      { camp_id: 'G', animal_count: 30 },
      { camp_id: 'H', animal_count: 50 },
      { camp_id: 'I', animal_count: 55 },
      { camp_id: 'J', animal_count: 35 },
      { camp_id: 'K', animal_count: 80 },
      { camp_id: 'L', animal_count: 20 },
      { camp_id: 'M', animal_count: 70 },
      { camp_id: 'N', animal_count: 35 },
      { camp_id: 'O', animal_count: 40 },
      { camp_id: 'P', animal_count: 30 },
      { camp_id: 'Q', animal_count: 16 },
    ];
    const r = reconcile(farm, camps);
    expect(r.animalsAgree).toBe(true);
    expect(r.campsAgree).toBe(true);
    expect(r.summed).toBe(874);
  });

  it('catches the exact PRD #128 bug: farm says 874 but admin overview says 0', () => {
    // The pathology that shipped past CI: admin overview .catch(() => 0)
    // hides a thrown DB error and reports 0 instead of failing the page.
    const farm = { animalCount: 0, campCount: 0 };
    const camps: CampRow[] = [
      { camp_id: 'A', animal_count: 71 },
      { camp_id: 'B', animal_count: 65 },
    ];
    const r = reconcile(farm, camps);
    expect(r.animalsAgree).toBe(false);
    expect(r.campsAgree).toBe(false);
  });

  it('agrees on an empty tenant', () => {
    expect(reconcile({ animalCount: 0, campCount: 0 }, [])).toEqual({
      animalsAgree: true,
      campsAgree: true,
      summed: 0,
    });
  });

  it('treats a missing animal_count column as zero (defensive)', () => {
    const farm = { animalCount: 0, campCount: 1 };
    const camps = [{ camp_id: 'A' } as CampRow];
    const r = reconcile(farm, camps);
    expect(r.animalsAgree).toBe(true);
    expect(r.campsAgree).toBe(true);
  });
});
