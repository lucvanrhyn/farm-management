/**
 * lib/server/__tests__/camp-mob-species-types.test.ts
 *
 * Phase A of #28 — type-level guarantees for the new `species` columns.
 *
 * The migration tests (./migration-camp-mob-species.test.ts) prove the
 * runtime SQL behaviour. This file proves that the Prisma client types
 * generated from the schema match the contract Phase B's API layer relies
 * on:
 *
 *   1. `Camp.species` and `Mob.species` are EXPOSED as `string` on the
 *      result payload (NOT NULL in the DB → never `string | null`).
 *      This is what lets `getCachedFarmSummary` filter `where: { species }`
 *      in Phase C without falling back to a `?? "cattle"` coalesce.
 *
 *   2. The composite UNIQUE on (species, campId) is reachable via the
 *      typed `Camp_species_campId_key` compound key, which is what
 *      `app/api/camps/route.ts` POST will use in Phase D.
 *
 *   3. `species` is filterable in `where` clauses (StringFilter), which
 *      every cross-cutting read in Phase C depends on.
 *
 * Vitest treats this file as a normal test (so it shows up in CI), but
 * the assertions are pure type checks — the `it()` body is intentionally
 * trivial. If the schema regresses (`species` made nullable, compound key
 * renamed, etc.), `pnpm typecheck` fails before vitest even runs.
 */

import { describe, it, expect } from 'vitest';
import type { Camp, Mob, Prisma } from '@prisma/client';

// ── Helpers: Equal<A, B> evaluates to true iff A and B are mutually
// assignable. Borrowed from the standard `tsd`-style trick. We do NOT
// pull in tsd as a dep — this 4-line helper is enough.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

function assertType<T extends true>(_: T): void {
  // no-op — purely for type-level inspection.
}

describe('Phase A schema types — Camp.species + Mob.species', () => {
  it('Camp.species is string (NOT NULL) on the result payload', () => {
    type SpeciesField = Camp['species'];
    assertType<Equal<SpeciesField, string>>(true);
    expect(true).toBe(true);
  });

  it('Mob.species is string (NOT NULL) on the result payload', () => {
    type SpeciesField = Mob['species'];
    assertType<Equal<SpeciesField, string>>(true);
    expect(true).toBe(true);
  });

  it('CampWhereInput exposes species for cross-cutting filter reads (Phase C)', () => {
    // Pin that `species` is a valid `where` key. If the field is removed or
    // renamed, this property access stops typechecking.
    const where: Prisma.CampWhereInput = { species: 'cattle' };
    expect(where.species).toBe('cattle');
  });

  it('MobWhereInput exposes species for cross-cutting filter reads (Phase C)', () => {
    const where: Prisma.MobWhereInput = { species: 'sheep' };
    expect(where.species).toBe('sheep');
  });

  it('Camp_species_campId_key compound unique is reachable on CampWhereUniqueInput', () => {
    // The `findUnique({ where: { Camp_species_campId_key: { species, campId } } })`
    // call site is what `app/api/camps/route.ts` POST will use to detect
    // duplicates in Phase D. Pin the shape now so a schema typo doesn't
    // silently break the API later.
    const where: Prisma.CampWhereUniqueInput = {
      Camp_species_campId_key: { species: 'cattle', campId: 'NORTH-01' },
    };
    expect(where.Camp_species_campId_key?.campId).toBe('NORTH-01');
  });

  it('CampCreateInput accepts species as optional (DB default backfills omitted values)', () => {
    // Existing call sites that omit `species` continue to compile because
    // the column has `@default("cattle")`. Phase B's API hardening will
    // ALWAYS set species explicitly, but Phase A keeps backwards-compat
    // at the Prisma type level so we don't break unrelated tests in this
    // wave.
    const _withoutSpecies: Prisma.CampCreateInput = {
      campId: 'NORTH-01',
      campName: 'North',
    };
    const _withSpecies: Prisma.CampCreateInput = {
      campId: 'NORTH-01',
      campName: 'North',
      species: 'cattle',
    };
    expect(_withoutSpecies.campId).toBe('NORTH-01');
    expect(_withSpecies.species).toBe('cattle');
  });

  it('species rejects non-string types in CampCreateInput', () => {
    // Phase B's typed-error path relies on `species` being a string. If
    // someone re-declares it as a nullable column or an enum-of-strings,
    // this @ts-expect-error stops compiling and forces a Phase B audit.
    const _bad: Prisma.CampCreateInput = {
      campId: 'NORTH-01',
      campName: 'North',
      // @ts-expect-error — species must be a string, not a number
      species: 123,
    };
    expect(_bad.campId).toBe('NORTH-01');
  });
});
