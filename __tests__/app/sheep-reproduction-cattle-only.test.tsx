/**
 * @vitest-environment jsdom
 *
 * __tests__/app/sheep-reproduction-cattle-only.test.tsx
 *
 * Deep-audit P1 (2026-05-03): /[farmSlug]/sheep/reproduction crashes on a
 * cattle-only tenant (e.g. acme-cattle — 103 cattle, 0 sheep) because
 * the page assumes sheep data exists and unsafely casts
 * `dashData.speciesSpecific` to a sheep-shape struct.
 *
 * The fix follows the existing convention used by other [farmSlug] pages
 * (tools/veld, tools/feed-on-offer, tools/drought, admin/animals/[id]):
 * call `notFound()` from `next/navigation` when the route is not valid for
 * this tenant. The trigger here is "sheep is not enabled on this farm".
 *
 * We mock every dependency so we never hit Prisma. We assert the page
 * short-circuits via `notFound()` BEFORE the unsafe cast on line 158
 * could ever execute.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirror Next.js's real notFound(): throws an Error with digest
// "NEXT_NOT_FOUND" so the framework can identify the 404 short-circuit.
// The page's catch block uses that digest to distinguish a notFound()
// throw from a real settings-fetch error.
const notFoundMock = vi.fn(() => {
  const err = new Error('__NOT_FOUND__') as Error & { digest: string };
  err.digest = 'NEXT_NOT_FOUND';
  throw err;
});

const getFarmCredsMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getCachedFarmSpeciesSettingsMock = vi.fn();
const getReproStatsMock = vi.fn();
const getAlertsMock = vi.fn();
const getDashboardDataMock = vi.fn();

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
vi.mock('@/lib/meta-db', () => ({ getFarmCreds: getFarmCredsMock }));
vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: getPrismaForFarmMock,
}));
vi.mock('@/lib/server/cached', () => ({
  getCachedFarmSpeciesSettings: getCachedFarmSpeciesSettingsMock,
}));
vi.mock('@/lib/species/sheep/index', () => ({
  sheepModule: {
    getReproStats: getReproStatsMock,
    getAlerts: getAlertsMock,
    getDashboardData: getDashboardDataMock,
  },
}));

// Stub heavy client-component subtrees that jsdom can't fully render.
vi.mock('@/components/admin/UpgradePrompt', () => ({ default: () => null }));
vi.mock('@/components/sheep/UpcomingLambingsTable', () => ({ default: () => null }));
vi.mock('@/components/sheep/OverdueLambingsTable', () => ({ default: () => null }));

function makePrismaMockWithoutSheep() {
  return {
    observation: { findMany: vi.fn().mockResolvedValue([]) },
    camp: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe('sheep/reproduction page — cattle-only tenant guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Tier check passes (advanced tier).
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });
    // Prisma client resolves so we don't bail at the early "Farm not found".
    getPrismaForFarmMock.mockResolvedValue(makePrismaMockWithoutSheep());

    // The dangerous case: sheep-domain calls return shapes that DON'T satisfy
    // the unguarded `as { ewesActive, ramsActive, lambsActive }` cast on the
    // page. Pre-fix this is what lights up the production crash on render.
    getReproStatsMock.mockResolvedValue({
      lambingPercentage: null,
      lambings12m: 0,
      joinings12m: 0,
      upcomingBirths: [],
    });
    getAlertsMock.mockResolvedValue([]);
    getDashboardDataMock.mockResolvedValue({
      activeCount: 0,
      // Cattle-only farm — no sheep aggregator ran, no ewes/rams/lambs keys.
      speciesSpecific: {},
    });
  });

  it('calls notFound() when sheep species is not enabled on this tenant', async () => {
    getCachedFarmSpeciesSettingsMock.mockResolvedValue({
      enabledSpecies: ['cattle'], // cattle-only — sheep NOT enabled
    });

    const mod = await import('@/app/[farmSlug]/sheep/reproduction/page');
    const Page = mod.default as (props: {
      params: Promise<{ farmSlug: string }>;
    }) => Promise<unknown>;

    await expect(
      Page({ params: Promise.resolve({ farmSlug: 'acme-cattle' }) }),
    ).rejects.toThrow('__NOT_FOUND__');

    expect(notFoundMock).toHaveBeenCalledTimes(1);
    // Sheep aggregators must NEVER be invoked on a cattle-only tenant —
    // they assume sheep tables/data exist.
    expect(getReproStatsMock).not.toHaveBeenCalled();
    expect(getDashboardDataMock).not.toHaveBeenCalled();
  });

  it('renders normally when sheep species IS enabled', async () => {
    getCachedFarmSpeciesSettingsMock.mockResolvedValue({
      enabledSpecies: ['cattle', 'sheep'],
    });
    // Provide a valid sheep-shape so the cast succeeds.
    getDashboardDataMock.mockResolvedValue({
      activeCount: 12,
      speciesSpecific: { ewesActive: 8, ramsActive: 1, lambsActive: 3 },
    });

    const mod = await import('@/app/[farmSlug]/sheep/reproduction/page');
    const Page = mod.default as (props: {
      params: Promise<{ farmSlug: string }>;
    }) => Promise<unknown>;

    const result = await Page({
      params: Promise.resolve({ farmSlug: 'sheep-tenant' }),
    });

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
    expect(getReproStatsMock).toHaveBeenCalledTimes(1);
    expect(getDashboardDataMock).toHaveBeenCalledTimes(1);
  });
});
