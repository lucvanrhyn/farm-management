/**
 * __tests__/breeding/breeding-constants.test.ts
 *
 * Phase F — multi-species breeding analytics.
 *
 * Locks in the per-species constants table that powers
 * `lib/server/breeding/{snapshot,pairings,scoring}.ts`. Constants are looked
 * up by species id at runtime; an unknown species throws a typed error
 * (NOT silent fallback to cattle).
 */

import { describe, it, expect } from 'vitest';
import {
  getBreedingConstants,
  UnknownBreedingSpeciesError,
} from '@/lib/species/breeding-constants';

describe('getBreedingConstants', () => {
  it('returns cattle constants with the historical 285d gestation (regression-safe)', () => {
    const c = getBreedingConstants('cattle');
    expect(c.gestationDays).toBe(285);
    expect(c.sireCategory).toBe('Bull');
    expect(c.femaleCategories).toEqual(['Cow', 'Heifer']);
    expect(c.youngFemaleCategory).toBe('Heifer');
    expect(c.highBirthWeightKg).toBe(38);
  });

  it('returns sheep constants with 150d gestation', () => {
    const c = getBreedingConstants('sheep');
    expect(c.gestationDays).toBe(150);
    expect(c.sireCategory).toBe('Ram');
    expect(c.femaleCategories).toEqual(expect.arrayContaining(['Ewe']));
    expect(c.youngFemaleCategory).toBe('Maiden Ewe');
    // Lambs are much lighter than calves
    expect(c.highBirthWeightKg).toBeLessThan(c.gestationDays); // sanity
    expect(c.highBirthWeightKg).toBeGreaterThan(0);
  });

  it('returns game constants with conservative defaults (kudu-class)', () => {
    const c = getBreedingConstants('game');
    expect(c.gestationDays).toBeGreaterThan(0);
    expect(c.sireCategory).toBe('Adult Male');
    expect(c.femaleCategories).toEqual(expect.arrayContaining(['Adult Female']));
    expect(c.youngFemaleCategory).toBe('Sub-adult');
    expect(c.highBirthWeightKg).toBeGreaterThan(0);
  });

  it('throws a typed error for unknown species (no silent fallback)', () => {
    expect(() => getBreedingConstants('llama' as never)).toThrow(
      UnknownBreedingSpeciesError,
    );
    expect(() => getBreedingConstants('' as never)).toThrow(
      UnknownBreedingSpeciesError,
    );
  });

  it('all numeric fields are finite (no NaN/Infinity for any species)', () => {
    for (const species of ['cattle', 'sheep', 'game'] as const) {
      const c = getBreedingConstants(species);
      expect(Number.isFinite(c.gestationDays)).toBe(true);
      expect(Number.isFinite(c.highBirthWeightKg)).toBe(true);
      expect(c.gestationDays).toBeGreaterThan(0);
      expect(c.highBirthWeightKg).toBeGreaterThan(0);
    }
  });
});
