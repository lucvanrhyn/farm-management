import { describe, it, expect } from 'vitest';
import {
  GESTATION_TABLE,
  getGestationDays,
  getGestationEntries,
  type GestationBreed,
  type GestationEntry,
} from '@/lib/species/gestation';

describe('GESTATION_TABLE structural invariants', () => {
  it('every entry has a positive, finite day count', () => {
    for (const entry of Object.values(GESTATION_TABLE)) {
      expect(entry.days).toBeGreaterThan(0);
      expect(Number.isFinite(entry.days)).toBe(true);
    }
  });

  it("every entry's key matches its breed field (internal consistency)", () => {
    for (const [key, entry] of Object.entries(GESTATION_TABLE)) {
      expect(entry.breed).toBe(key);
    }
  });

  it('every entry declares a non-empty label and source URL', () => {
    for (const entry of Object.values(GESTATION_TABLE)) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.source).toMatch(/^https?:\/\//);
    }
  });

  it('every entry has a valid species discriminator', () => {
    const valid: GestationEntry['species'][] = ['cattle', 'sheep', 'goat', 'pig', 'game'];
    for (const entry of Object.values(GESTATION_TABLE)) {
      expect(valid).toContain(entry.species);
    }
  });
});

describe('cattle gestation values (Select Sires / BRC Ranch range)', () => {
  it('all cattle entries fall within 279..291 days', () => {
    const cattle = getGestationEntries('cattle');
    expect(cattle.length).toBeGreaterThanOrEqual(3);
    for (const c of cattle) {
      expect(c.days).toBeGreaterThanOrEqual(279);
      expect(c.days).toBeLessThanOrEqual(291);
    }
  });

  it('Bonsmara is 283d (Select Sires generic beef)', () => {
    expect(getGestationDays('cattle_bonsmara')).toBe(283);
  });

  it('Brahman is 291d (BRC Ranch table)', () => {
    expect(getGestationDays('cattle_brahman')).toBe(291);
  });

  it('Holstein is 279d (dairy reference)', () => {
    expect(getGestationDays('cattle_holstein')).toBe(279);
  });
});

describe('sheep gestation values (MLA / Dohne range)', () => {
  it('all sheep entries fall within 140..155 days', () => {
    const sheep = getGestationEntries('sheep');
    expect(sheep.length).toBeGreaterThanOrEqual(2);
    for (const s of sheep) {
      expect(s.days).toBeGreaterThanOrEqual(140);
      expect(s.days).toBeLessThanOrEqual(155);
    }
  });

  it('Dohne is 147d (research brief)', () => {
    expect(getGestationDays('sheep_dohne')).toBe(147);
  });

  it('Merino is 150d (MLA)', () => {
    expect(getGestationDays('sheep_merino')).toBe(150);
  });
});

describe('game gestation values match research brief table', () => {
  const expected: Array<[GestationBreed, number]> = [
    ['kudu', 240],
    ['impala', 197],
    ['wildebeest', 255],
    ['eland', 270],
    ['gemsbok', 270],
    ['warthog', 172],
  ];

  for (const [breed, days] of expected) {
    it(`${breed} is ${days}d`, () => {
      expect(getGestationDays(breed)).toBe(days);
    });
  }

  it('every game entry has species="game"', () => {
    const game = getGestationEntries('game');
    expect(game.length).toBeGreaterThanOrEqual(6);
    for (const g of game) {
      expect(g.species).toBe('game');
    }
  });
});

describe('getGestationDays() behaviour', () => {
  it('returns the table value for a known breed', () => {
    expect(getGestationDays('goat_boer')).toBe(150);
    expect(getGestationDays('pig_generic')).toBe(114);
  });

  it('throws on an unknown breed (fail-fast at system boundary)', () => {
    // @ts-expect-error — deliberately passing an invalid literal to test the guard
    expect(() => getGestationDays('unknown_breed')).toThrow(/Unknown gestation breed/);
  });
});

describe('getGestationEntries() behaviour', () => {
  it('returns a fresh copy (callers cannot mutate the table)', () => {
    const first = getGestationEntries();
    const second = getGestationEntries();
    expect(first).not.toBe(second);
    first.pop();
    expect(second.length).toBe(Object.keys(GESTATION_TABLE).length);
  });

  it('filters correctly by species and returns the full list with no filter', () => {
    const all = getGestationEntries();
    const cattle = getGestationEntries('cattle');
    const game = getGestationEntries('game');
    expect(all.length).toBe(Object.keys(GESTATION_TABLE).length);
    expect(cattle.every((e) => e.species === 'cattle')).toBe(true);
    expect(game.every((e) => e.species === 'game')).toBe(true);
    expect(cattle.length + game.length).toBeLessThan(all.length); // sheep/goat/pig also exist
  });
});
