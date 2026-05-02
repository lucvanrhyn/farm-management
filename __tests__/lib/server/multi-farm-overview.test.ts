/**
 * __tests__/lib/server/multi-farm-overview.test.ts
 *
 * Tests for the multi-farm overview aggregator. Uses mocked Prisma + meta-db
 * so no real DB connection is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionFarm } from '@/types/next-auth';

// Mock getPrismaForFarm — the module under test imports this.
vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: vi.fn(),
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

const makeFarm = (slug: string): SessionFarm => ({
  slug,
  displayName: slug,
  role: 'ADMIN',
  logoUrl: null,
  tier: 'basic',
  subscriptionStatus: 'active',
});

function makeMockPrisma(overrides: {
  animalCount?: number;
  campCount?: number;
  latestObs?: { createdAt: Date } | null;
  throwOnAnimalCount?: boolean;
} = {}) {
  return {
    animal: {
      count: vi.fn().mockImplementation(async () => {
        if (overrides.throwOnAnimalCount) {
          throw new Error('boom');
        }
        return overrides.animalCount ?? 0;
      }),
    },
    camp: {
      count: vi.fn().mockResolvedValue(overrides.campCount ?? 0),
    },
    observation: {
      findFirst: vi.fn().mockResolvedValue(overrides.latestObs ?? null),
    },
  };
}

describe('getOverviewForUserFarms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns active animal count for a farm with animals (uses "Active" casing)', async () => {
    const { getPrismaForFarm } = await import('@/lib/farm-prisma');
    const prismaMock = makeMockPrisma({ animalCount: 874, campCount: 12 });
    vi.mocked(getPrismaForFarm).mockResolvedValue(prismaMock as never);

    const { getOverviewForUserFarms } = await import('@/lib/server/multi-farm-overview');
    const result = await getOverviewForUserFarms([makeFarm('big-farm')]);

    expect(result).toHaveLength(1);
    expect(result[0].activeAnimalCount).toBe(874);
    expect(result[0].campCount).toBe(12);
    // Verify the where-clause uses the capital-A "Active" enum value that
    // matches the Prisma schema default — this is the root cause of the
    // original "0 animals" bug.
    expect(prismaMock.animal.count).toHaveBeenCalledWith({
      where: { status: 'Active' },
    });
  });

  it('returns 0 for a genuinely empty farm (new farm)', async () => {
    const { getPrismaForFarm } = await import('@/lib/farm-prisma');
    vi.mocked(getPrismaForFarm).mockResolvedValue(
      makeMockPrisma({ animalCount: 0 }) as never,
    );

    const { getOverviewForUserFarms } = await import('@/lib/server/multi-farm-overview');
    const result = await getOverviewForUserFarms([makeFarm('new-farm')]);

    expect(result[0].activeAnimalCount).toBe(0);
  });

  it('returns null counts when Prisma throws (real unavailable state)', async () => {
    const { getPrismaForFarm } = await import('@/lib/farm-prisma');
    vi.mocked(getPrismaForFarm).mockResolvedValue(
      makeMockPrisma({ throwOnAnimalCount: true }) as never,
    );

    const { getOverviewForUserFarms } = await import('@/lib/server/multi-farm-overview');
    const result = await getOverviewForUserFarms([makeFarm('dead-shard')]);

    expect(result[0].activeAnimalCount).toBeNull();
    expect(result[0].campCount).toBeNull();
  });

  it('returns null counts when getPrismaForFarm returns null', async () => {
    const { getPrismaForFarm } = await import('@/lib/farm-prisma');
    vi.mocked(getPrismaForFarm).mockResolvedValue(null);

    const { getOverviewForUserFarms } = await import('@/lib/server/multi-farm-overview');
    const result = await getOverviewForUserFarms([makeFarm('missing-creds')]);

    expect(result[0].activeAnimalCount).toBeNull();
  });

  it('returns lastObservationAtMs as a number (JSON-safe for unstable_cache)', async () => {
    // Regression: FarmOverview used to expose `lastObservationAt: Date | null`,
    // but this object is wrapped in `unstable_cache` which JSON-round-trips
    // the payload. JSON.stringify(Date) → ISO string; JSON.parse leaves it a
    // string; the component then called `.getTime()` and crashed.
    //
    // Fix: expose epoch-ms (`number | null`) — JSON-native, no lie.
    const { getPrismaForFarm } = await import('@/lib/farm-prisma');
    const created = new Date('2026-04-20T10:15:00Z');
    vi.mocked(getPrismaForFarm).mockResolvedValue(
      makeMockPrisma({ animalCount: 5, latestObs: { createdAt: created } }) as never,
    );

    const { getOverviewForUserFarms } = await import('@/lib/server/multi-farm-overview');
    const result = await getOverviewForUserFarms([makeFarm('obs-farm')]);

    expect(typeof result[0].lastObservationAtMs).toBe('number');
    expect(result[0].lastObservationAtMs).toBe(created.getTime());

    // And — the whole point — it must survive a JSON round-trip unchanged.
    const roundTripped = JSON.parse(JSON.stringify(result[0]));
    expect(roundTripped.lastObservationAtMs).toBe(created.getTime());
    expect(typeof roundTripped.lastObservationAtMs).toBe('number');
  });

  it('returns null lastObservationAtMs when farm has no observations', async () => {
    const { getPrismaForFarm } = await import('@/lib/farm-prisma');
    vi.mocked(getPrismaForFarm).mockResolvedValue(
      makeMockPrisma({ animalCount: 0, latestObs: null }) as never,
    );

    const { getOverviewForUserFarms } = await import('@/lib/server/multi-farm-overview');
    const result = await getOverviewForUserFarms([makeFarm('fresh-farm')]);

    expect(result[0].lastObservationAtMs).toBeNull();
  });

  it('caps at 8 farms', async () => {
    const { getPrismaForFarm } = await import('@/lib/farm-prisma');
    vi.mocked(getPrismaForFarm).mockResolvedValue(
      makeMockPrisma({ animalCount: 1 }) as never,
    );

    const farms = Array.from({ length: 12 }, (_, i) => makeFarm(`farm-${i}`));
    const { getOverviewForUserFarms } = await import('@/lib/server/multi-farm-overview');
    const result = await getOverviewForUserFarms(farms);

    expect(result).toHaveLength(8);
  });
});
