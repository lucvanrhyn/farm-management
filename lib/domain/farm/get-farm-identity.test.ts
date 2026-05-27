// @vitest-environment node
/**
 * lib/domain/farm/get-farm-identity.test.ts
 *
 * Unit tests for getFarmIdentity — the deep module that drives the
 * server-rendered farm hero on /[farmSlug]/home (issue #438, PRD #434).
 *
 * Tests follow the RED→GREEN→REFACTOR TDD cycle per
 * superpowers:test-driven-development.
 *
 * Four behaviours under test:
 *   1. Happy path — FarmSettings row present → returns shaped identity
 *   2. Missing FarmSettings → returns safe defaults
 *   3. Missing farm (withFarmPrisma throws) → propagates error
 *   4. Cache tag — the unstable_cache wrapper uses tag `farm-<slug>-identity`
 *      (structural assertion via named-export inspection)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state (feedback-vi-hoisted-shared-mocks.md) ─────────────────
const mockState = vi.hoisted(() => ({
  farmSettingsRow: null as Record<string, unknown> | null,
  animalCount: 0 as number,
  campCount: 0 as number,
  shouldThrow: false as boolean,
}));

// Mock withFarmPrisma to inject a controlled Prisma instance
vi.mock('@/lib/farm-prisma', () => ({
  withFarmPrisma: vi.fn(
    async (slug: string, fn: (prisma: unknown) => Promise<unknown>) => {
      if (mockState.shouldThrow) throw new Error(`farm "${slug}" not found`);
      // Minimal Prisma-shaped mock: crossSpecies door passes through, so
      // the farm-identity module calls prisma.farmSettings.findFirst(),
      // prisma.animal.count(), prisma.camp.count() through crossSpecies().
      const prisma = {
        farmSettings: {
          findFirst: vi.fn(async () => mockState.farmSettingsRow),
        },
        animal: {
          count: vi.fn(async () => mockState.animalCount),
        },
        camp: {
          count: vi.fn(async () => mockState.campCount),
        },
      };
      return fn(prisma);
    },
  ),
}));

// Mock crossSpecies to be a transparent pass-through (ADR-0005 door —
// it must be called but for these unit tests it just forwards the prisma).
vi.mock('@/lib/server/species-scoped-prisma', () => ({
  crossSpecies: vi.fn((prisma: unknown, _reason: string) => prisma),
}));

// Mock next/cache — unstable_cache should call through to the inner function
// in tests (no caching), and we capture the tags to assert structural contract.
const capturedCacheOptions = vi.hoisted(() => ({ tags: [] as string[] }));
vi.mock('next/cache', () => ({
  unstable_cache: vi.fn(
    (fn: (...args: unknown[]) => unknown, _keys: string[], opts: { tags?: string[] }) => {
      // Capture the tags from the last call
      capturedCacheOptions.tags = opts?.tags ?? [];
      // Return a function that calls through (no caching in tests)
      return fn;
    },
  ),
  revalidateTag: vi.fn(),
}));

import { getFarmIdentity } from './get-farm-identity';

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockState.farmSettingsRow = null;
  mockState.animalCount = 0;
  mockState.campCount = 0;
  mockState.shouldThrow = false;
  vi.clearAllMocks();
});

describe('getFarmIdentity()', () => {
  describe('happy path — FarmSettings row present', () => {
    it('returns farmName, breed, heroImageUrl, animalCount, campCount from DB', async () => {
      mockState.farmSettingsRow = {
        farmName: 'Trio B Boerdery',
        breed: 'Bonsmara',
        heroImageUrl: '/uploads/trio-hero.jpg',
      };
      mockState.animalCount = 874;
      mockState.campCount = 19;

      const result = await getFarmIdentity('trio-b-boerdery');

      expect(result).toEqual({
        farmName: 'Trio B Boerdery',
        breed: 'Bonsmara',
        heroImageUrl: '/uploads/trio-hero.jpg',
        animalCount: 874,
        campCount: 19,
      });
    });

    it('uses heroImageUrl from settings when present', async () => {
      mockState.farmSettingsRow = {
        farmName: 'Basson Boerdery',
        breed: 'Simmentaler',
        heroImageUrl: '/uploads/basson-hero.jpg',
      };
      mockState.animalCount = 103;
      mockState.campCount = 9;

      const result = await getFarmIdentity('basson-boerdery');

      expect(result.heroImageUrl).toBe('/uploads/basson-hero.jpg');
    });
  });

  describe('missing FarmSettings — safe defaults', () => {
    it('returns default farmName and breed when FarmSettings is null', async () => {
      mockState.farmSettingsRow = null;
      mockState.animalCount = 0;
      mockState.campCount = 0;

      const result = await getFarmIdentity('new-farm');

      expect(result.farmName).toBe('My Farm');
      expect(result.breed).toBe('Mixed');
    });

    it('returns default heroImageUrl when FarmSettings.heroImageUrl is null', async () => {
      mockState.farmSettingsRow = {
        farmName: 'Old Farm',
        breed: 'Hereford',
        heroImageUrl: null,
      };

      const result = await getFarmIdentity('old-farm');

      expect(result.heroImageUrl).toBe('/farm-hero.jpg');
    });

    it('returns zero counts when animal/camp counts are 0', async () => {
      mockState.farmSettingsRow = { farmName: 'Empty Farm', breed: 'Mixed', heroImageUrl: null };
      mockState.animalCount = 0;
      mockState.campCount = 0;

      const result = await getFarmIdentity('empty-farm');

      expect(result.animalCount).toBe(0);
      expect(result.campCount).toBe(0);
    });
  });

  describe('missing farm — propagates error', () => {
    it('throws when withFarmPrisma throws a not-found error', async () => {
      mockState.shouldThrow = true;

      await expect(getFarmIdentity('nonexistent-farm')).rejects.toThrow(
        'farm "nonexistent-farm" not found',
      );
    });
  });

  describe('cache tag — structural contract', () => {
    it('tags the unstable_cache with farm-<slug>-identity', async () => {
      mockState.farmSettingsRow = { farmName: 'Test Farm', breed: 'Mixed', heroImageUrl: null };

      await getFarmIdentity('test-slug');

      expect(capturedCacheOptions.tags).toContain('farm-test-slug-identity');
    });

    it('uses a slug-specific tag so different farms get independent cache entries', async () => {
      mockState.farmSettingsRow = { farmName: 'Farm A', breed: 'Hereford', heroImageUrl: null };
      await getFarmIdentity('farm-a');

      const tagsForFarmA = [...capturedCacheOptions.tags];

      mockState.farmSettingsRow = { farmName: 'Farm B', breed: 'Angus', heroImageUrl: null };
      await getFarmIdentity('farm-b');

      // Tag for farm-a should NOT appear in farm-b's tags
      expect(capturedCacheOptions.tags).not.toContain('farm-farm-a-identity');
      expect(capturedCacheOptions.tags).toContain('farm-farm-b-identity');
      expect(tagsForFarmA).toContain('farm-farm-a-identity');
    });
  });
});
