import { describe, it, expect } from 'vitest';
import {
  computeFarmLsuFromQueryResults,
  type CategoryBucket,
  type GameSpeciesPopulation,
} from '../farm-lsu';

// Use fabricated weights to keep tests independent of module config drift.
const WEIGHTS: Record<string, number> = {
  Cow: 1.0,
  Bull: 1.5,
  Heifer: 0.75,
  Calf: 0.25,
  Ewe: 0.17,
  Ram: 0.2,
  Lamb: 0.07,
};

describe('computeFarmLsuFromQueryResults — Animal table only', () => {
  it('100 cows → 100 LSU', () => {
    const animals: CategoryBucket[] = [{ category: 'Cow', count: 100 }];
    expect(computeFarmLsuFromQueryResults(animals, [], WEIGHTS)).toBe(100);
  });

  it('mixed cattle categories: 200 Cow + 300 Bull + 100 Calf = 675', () => {
    const animals: CategoryBucket[] = [
      { category: 'Cow', count: 200 },
      { category: 'Bull', count: 300 },
      { category: 'Calf', count: 100 },
    ];
    // 200*1 + 300*1.5 + 100*0.25 = 200 + 450 + 25 = 675
    expect(computeFarmLsuFromQueryResults(animals, [], WEIGHTS)).toBe(675);
  });

  it('mixed cattle + sheep: 100 Cow + 500 Ewe = 185', () => {
    const animals: CategoryBucket[] = [
      { category: 'Cow', count: 100 },
      { category: 'Ewe', count: 500 },
    ];
    // 100*1 + 500*0.17 = 100 + 85 = 185
    expect(computeFarmLsuFromQueryResults(animals, [], WEIGHTS)).toBe(185);
  });

  it('defaults unknown category to 1.0 LSU (via calcLsu)', () => {
    // calcLsu's defaultLsu is 1.0 — so an unknown "Alien" category counts as cattle-weight.
    const animals: CategoryBucket[] = [{ category: 'Alien', count: 10 }];
    expect(computeFarmLsuFromQueryResults(animals, [], WEIGHTS)).toBe(10);
  });

  it('empty roster → 0', () => {
    expect(computeFarmLsuFromQueryResults([], [], WEIGHTS)).toBe(0);
  });

  it('rounds to nearest integer: 33 Ewe × 0.17 = 5.61 → 6', () => {
    const animals: CategoryBucket[] = [{ category: 'Ewe', count: 33 }];
    // 33 * 0.17 = 5.61 → round → 6
    expect(computeFarmLsuFromQueryResults(animals, [], WEIGHTS)).toBe(6);
  });
});

describe('computeFarmLsuFromQueryResults — GameSpecies only', () => {
  it('200 kudu (0.4) + 600 impala (0.15) = 170 LSU', () => {
    const game: GameSpeciesPopulation[] = [
      { population: 200, lsuEquivalent: 0.4 },
      { population: 600, lsuEquivalent: 0.15 },
    ];
    // 200*0.4 + 600*0.15 = 80 + 90 = 170
    expect(computeFarmLsuFromQueryResults([], game, WEIGHTS)).toBe(170);
  });

  it('empty game list → 0', () => {
    expect(computeFarmLsuFromQueryResults([], [], WEIGHTS)).toBe(0);
  });

  it('rounds fractional game LSU: 7 impala × 0.15 = 1.05 → 1', () => {
    const game: GameSpeciesPopulation[] = [{ population: 7, lsuEquivalent: 0.15 }];
    expect(computeFarmLsuFromQueryResults([], game, WEIGHTS)).toBe(1);
  });
});

describe('computeFarmLsuFromQueryResults — mixed Animal + GameSpecies', () => {
  it('100 Cow + 200 kudu @ 0.4 = 100 + 80 = 180 LSU', () => {
    const animals: CategoryBucket[] = [{ category: 'Cow', count: 100 }];
    const game: GameSpeciesPopulation[] = [{ population: 200, lsuEquivalent: 0.4 }];
    expect(computeFarmLsuFromQueryResults(animals, game, WEIGHTS)).toBe(180);
  });

  it('rounds once at the end to avoid drift', () => {
    // Animal side: 33 Ewe × 0.17 = 5.61
    // Game side:   7 impala × 0.15 = 1.05
    // Sum before round: 6.66 → round → 7
    // If we rounded each separately we would get 6 + 1 = 7 — same here,
    // but verify the contract holds.
    const animals: CategoryBucket[] = [{ category: 'Ewe', count: 33 }];
    const game: GameSpeciesPopulation[] = [{ population: 7, lsuEquivalent: 0.15 }];
    expect(computeFarmLsuFromQueryResults(animals, game, WEIGHTS)).toBe(7);
  });

  it('drift example: 0.5+0.5 = 1 (not 0+0=0 via separate rounding)', () => {
    // Animal side:  1 Heifer × 0.75 = 0.75. (calcLsu rounds? No — it returns float.)
    // Actually calcLsu is a raw sum, no rounding. Let's construct a real drift case:
    // Animal side: 1 Lamb @ 0.07 × 5 Lamb = 0.35
    // Game side:   1 pop × 0.15 = 0.15
    // Sum: 0.50 → round → 1 (round-half-up? JS Math.round(0.5) = 1)
    const animals: CategoryBucket[] = [{ category: 'Lamb', count: 5 }];
    const game: GameSpeciesPopulation[] = [{ population: 1, lsuEquivalent: 0.15 }];
    // 5*0.07 + 1*0.15 = 0.35 + 0.15 = 0.5 → Math.round → 1
    expect(computeFarmLsuFromQueryResults(animals, game, WEIGHTS)).toBe(1);
  });
});
