/**
 * lib/server/species/require-species-scoped-camp.test.ts
 *
 * TDD matrix for `requireSpeciesScopedCamp` — foundation helper for issue #116.
 * Consumed by #97 (mob orphan-camp hard-block) and #98 (animal cross-species PATCH).
 *
 * Spec: memory/multi-species-spec-2026-04-27.md
 *   "each species is a fully-isolated workspace inside one tenant"
 *   "Hard-block cross-species writes uniformly"
 *
 * Four result outcomes tested per species:
 *   ok: true        — camp exists and species matches
 *   NOT_FOUND       — no camp with that campId at all in the tenant
 *   WRONG_SPECIES   — camp exists but its species differs from the requested one
 *   ORPHANED        — camp row has a null species (covered by WRONG_SPECIES branch)
 *
 * Note: `farmSlug` is passed for call-site documentation only.
 * The Prisma client is already tenant-scoped — farmSlug is not used in queries.
 *
 * Mock strategy:
 *   - Step 1 (primary): `camp.findUnique` with composite key `Camp_species_campId_key`
 *   - Step 2 (fallback): `camp.findFirst` with bare `campId` filter
 *   Both mocks are registered in vi.hoisted so they are available when the
 *   module factory runs (see memory/feedback-vi-hoisted-shared-mocks.md).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { campFindUniqueMock, campFindFirstMock, prismaMock } = vi.hoisted(() => {
  const campFindUnique = vi.fn();
  const campFindFirst = vi.fn();
  const prisma = {
    camp: {
      findUnique: campFindUnique,
      findFirst: campFindFirst,
    },
  };
  return {
    campFindUniqueMock: campFindUnique,
    campFindFirstMock: campFindFirst,
    prismaMock: prisma,
  };
});

// Real implementation — no vi.mock of the module under test.
import { requireSpeciesScopedCamp } from './require-species-scoped-camp';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma(): PrismaClient {
  return prismaMock as unknown as PrismaClient;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('requireSpeciesScopedCamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default fallback: findFirst returns null (camp does not exist at all).
    // Individual tests override this when they need WRONG_SPECIES behaviour.
    campFindFirstMock.mockResolvedValue(null);
  });

  // ── cattle ───────────────────────────────────────────────────────────────

  describe('cattle', () => {
    it('ok:true — matching cattle camp exists', async () => {
      campFindUniqueMock.mockResolvedValueOnce({ id: 'c1', species: 'cattle' });

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'cattle',
        farmSlug: 'test-farm',
        campId: 'NORTH-01',
      });

      expect(result).toEqual({ ok: true, camp: { id: 'c1', species: 'cattle' } });
      // Verify composite-unique key is used — NOT findFirst — for the happy path.
      expect(campFindUniqueMock).toHaveBeenCalledWith({
        where: { Camp_species_campId_key: { species: 'cattle', campId: 'NORTH-01' } },
        select: { id: true, species: true },
      });
      // findFirst must not be called on the happy path.
      expect(campFindFirstMock).not.toHaveBeenCalled();
    });

    it('NOT_FOUND — campId does not exist in the tenant at all', async () => {
      campFindUniqueMock.mockResolvedValueOnce(null);
      // campFindFirstMock returns null (set in beforeEach).

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'cattle',
        farmSlug: 'test-farm',
        campId: 'GHOST-99',
      });

      expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
    });

    it('WRONG_SPECIES — campId exists but under sheep not cattle', async () => {
      campFindUniqueMock.mockResolvedValueOnce(null);
      campFindFirstMock.mockResolvedValueOnce({ id: 'c2', species: 'sheep' });

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'cattle',
        farmSlug: 'test-farm',
        campId: 'SHEEP-01',
      });

      expect(result).toEqual({ ok: false, reason: 'WRONG_SPECIES' });
    });
  });

  // ── sheep ────────────────────────────────────────────────────────────────

  describe('sheep', () => {
    it('ok:true — matching sheep camp exists', async () => {
      campFindUniqueMock.mockResolvedValueOnce({ id: 's1', species: 'sheep' });

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'sheep',
        farmSlug: 'test-farm',
        campId: 'VELD-01',
      });

      expect(result).toEqual({ ok: true, camp: { id: 's1', species: 'sheep' } });
      expect(campFindUniqueMock).toHaveBeenCalledWith({
        where: { Camp_species_campId_key: { species: 'sheep', campId: 'VELD-01' } },
        select: { id: true, species: true },
      });
      expect(campFindFirstMock).not.toHaveBeenCalled();
    });

    it('NOT_FOUND — campId does not exist in the tenant at all', async () => {
      campFindUniqueMock.mockResolvedValueOnce(null);
      // campFindFirstMock returns null (set in beforeEach).

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'sheep',
        farmSlug: 'test-farm',
        campId: 'NONEXISTENT',
      });

      expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
    });

    it('WRONG_SPECIES — same campId exists under cattle not sheep', async () => {
      campFindUniqueMock.mockResolvedValueOnce(null);
      campFindFirstMock.mockResolvedValueOnce({ id: 'c3', species: 'cattle' });

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'sheep',
        farmSlug: 'test-farm',
        campId: 'NORTH-01',
      });

      expect(result).toEqual({ ok: false, reason: 'WRONG_SPECIES' });
    });
  });

  // ── game ─────────────────────────────────────────────────────────────────

  describe('game', () => {
    it('ok:true — matching game camp exists', async () => {
      campFindUniqueMock.mockResolvedValueOnce({ id: 'g1', species: 'game' });

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'game',
        farmSlug: 'test-farm',
        campId: 'RESERVE-01',
      });

      expect(result).toEqual({ ok: true, camp: { id: 'g1', species: 'game' } });
      expect(campFindUniqueMock).toHaveBeenCalledWith({
        where: { Camp_species_campId_key: { species: 'game', campId: 'RESERVE-01' } },
        select: { id: true, species: true },
      });
      expect(campFindFirstMock).not.toHaveBeenCalled();
    });

    it('NOT_FOUND — campId does not exist in the tenant at all', async () => {
      campFindUniqueMock.mockResolvedValueOnce(null);
      // campFindFirstMock returns null (set in beforeEach).

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'game',
        farmSlug: 'test-farm',
        campId: 'GHOST-GAME',
      });

      expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
    });

    it('WRONG_SPECIES — same campId exists under cattle not game', async () => {
      campFindUniqueMock.mockResolvedValueOnce(null);
      campFindFirstMock.mockResolvedValueOnce({ id: 'c4', species: 'cattle' });

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'game',
        farmSlug: 'test-farm',
        campId: 'NORTH-01',
      });

      expect(result).toEqual({ ok: false, reason: 'WRONG_SPECIES' });
    });
  });

  // ── ORPHANED — camp with null species ────────────────────────────────────
  //
  // Camp.species is NOT NULL in the Prisma schema with @default("cattle"),
  // so a null value can only exist if a migration applied outside Prisma
  // left a row in an inconsistent state. We document that these rows are
  // treated as WRONG_SPECIES (null !== any valid species key).

  describe('ORPHANED (null species) rows', () => {
    it('WRONG_SPECIES — campId exists but species is null (orphaned/migrated row)', async () => {
      campFindUniqueMock.mockResolvedValueOnce(null);
      // findFirst finds a row but its species is null.
      campFindFirstMock.mockResolvedValueOnce({ id: 'orphan-1', species: null });

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'cattle',
        farmSlug: 'test-farm',
        campId: 'ORPHAN-CAMP',
      });

      // null is not the requested species → WRONG_SPECIES.
      expect(result).toEqual({ ok: false, reason: 'WRONG_SPECIES' });
    });

    it('NOT_FOUND — campId genuinely absent (null findFirst)', async () => {
      campFindUniqueMock.mockResolvedValueOnce(null);
      // campFindFirstMock returns null (set in beforeEach).

      const result = await requireSpeciesScopedCamp(makePrisma(), {
        species: 'cattle',
        farmSlug: 'test-farm',
        campId: 'TRULY-MISSING',
      });

      expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
    });
  });

  // ── Query shape verification ─────────────────────────────────────────────

  describe('query shape', () => {
    it('uses composite-unique key (not findFirst) for the primary lookup', async () => {
      campFindUniqueMock.mockResolvedValueOnce({ id: 'x1', species: 'sheep' });

      await requireSpeciesScopedCamp(makePrisma(), {
        species: 'sheep',
        farmSlug: 'my-farm',
        campId: 'CAMP-A',
      });

      expect(campFindUniqueMock).toHaveBeenCalledExactlyOnceWith({
        where: { Camp_species_campId_key: { species: 'sheep', campId: 'CAMP-A' } },
        select: { id: true, species: true },
      });
    });

    it('uses bare campId filter for the secondary existence check', async () => {
      campFindUniqueMock.mockResolvedValueOnce(null);
      campFindFirstMock.mockResolvedValueOnce({ id: 'x2', species: 'game' });

      await requireSpeciesScopedCamp(makePrisma(), {
        species: 'cattle',
        farmSlug: 'my-farm',
        campId: 'CAMP-B',
      });

      expect(campFindFirstMock).toHaveBeenCalledExactlyOnceWith({
        where: { campId: 'CAMP-B' },
        select: { id: true, species: true },
      });
    });

    it('does NOT call findFirst when the primary lookup succeeds', async () => {
      campFindUniqueMock.mockResolvedValueOnce({ id: 'x3', species: 'cattle' });

      await requireSpeciesScopedCamp(makePrisma(), {
        species: 'cattle',
        farmSlug: 'my-farm',
        campId: 'CAMP-C',
      });

      expect(campFindFirstMock).not.toHaveBeenCalled();
    });
  });
});
