/**
 * __tests__/perf/multi-farm-cache.test.ts
 *
 * Performance proof: getCachedMultiFarmOverview reduces DB round-trips from
 * N×3 (one per farm) to 0 on warm hits (cache TTL 60s).
 *
 * Methodology:
 *   1. Real Map-based unstable_cache mock (same as db-call-savings.test.ts)
 *   2. Simulate getOverviewForUserFarms with a tracked, latent mock
 *   3. Assert: underlying fetcher called ONCE on cold hit, ZERO times on warm
 *   4. Assert: tagged revalidation clears the cache entry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = "user-123";
const SIMULATED_DB_LATENCY_MS = 25;
const N_REQUESTS = 5;

// ── Real in-memory cache + tag registry ──────────────────────────────────────
//
// Implements the Next.js unstable_cache contract:
//   unstable_cache(fn, keyParts, { revalidate, tags }) → cachedFn
//   revalidateTag(tag, profile) → evicts all entries tagged with that tag

const _cache = new Map<string, unknown>();
const _tagIndex = new Map<string, Set<string>>(); // tag → Set<cacheKey>
let _fetcherCallCount = 0;

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn((tag: string, _profile?: string) => {
    const keys = _tagIndex.get(tag);
    if (keys) {
      for (const key of keys) {
        _cache.delete(key);
      }
      _tagIndex.delete(tag);
    }
  }),
  revalidatePath: vi.fn(),
  unstable_cache: (
    fn: (...args: unknown[]) => Promise<unknown>,
    keyParts: string[],
    opts?: { revalidate?: number; tags?: string[] },
  ) => {
    return async (...args: unknown[]) => {
      const cacheKey = JSON.stringify([keyParts, ...args]);
      if (_cache.has(cacheKey)) {
        return _cache.get(cacheKey);
      }
      const result = await fn(...args);
      _cache.set(cacheKey, result);
      // Register tags → cacheKey mapping for revalidation
      for (const tag of opts?.tags ?? []) {
        if (!_tagIndex.has(tag)) _tagIndex.set(tag, new Set());
        _tagIndex.get(tag)!.add(cacheKey);
      }
      return result;
    };
  },
}));

// ── Mock: getOverviewForUserFarms with latency + call tracking ────────────────
// Must be hoisted before cached.ts is imported (vi.mock is auto-hoisted).

vi.mock("@/lib/server/multi-farm-overview", () => ({
  getOverviewForUserFarms: vi.fn(async () => {
    _fetcherCallCount++;
    await new Promise((resolve) => setTimeout(resolve, SIMULATED_DB_LATENCY_MS));
    return MOCK_OVERVIEWS;
  }),
}));

// ── Stub all other dependencies pulled in by cached.ts ───────────────────────
// cached.ts has many top-level imports; stub them to avoid loading real modules.

vi.mock("@/lib/farm-prisma", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withFarmPrisma: vi.fn().mockImplementation((_slug: string, fn: (p: any) => Promise<unknown>) => {
    return fn({
      animal: { groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      camp: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      farmSpeciesSettings: { findMany: vi.fn().mockResolvedValue([{ species: "cattle", enabled: true }]) },
      observation: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null) },
      transaction: { findMany: vi.fn().mockResolvedValue([]) },
    });
  }),
  getPrismaForFarm: vi.fn(),
  getPrismaWithAuth: vi.fn(),
  getPrismaForSlugWithAuth: vi.fn(),
}));

vi.mock("@/lib/server/camp-status", () => ({
  getLatestCampConditions: vi.fn().mockResolvedValue(new Map()),
  countHealthIssuesSince: vi.fn().mockResolvedValue(0),
  countInspectedToday: vi.fn().mockResolvedValue(0),
  getRecentHealthObservations: vi.fn().mockResolvedValue([]),
  getLowGrazingCampCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/server/reproduction-analytics", () => ({
  getReproStats: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/server/dashboard-alerts", () => ({
  getDashboardAlerts: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/server/data-health", () => ({
  getDataHealthScore: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/server/treatment-analytics", () => ({
  getWithdrawalCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/species/game/analytics", () => ({
  getCensusPopulationByCamp: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/server/rotation-engine", () => ({
  getRotationStatusByCamp: vi.fn().mockResolvedValue({ camps: [] }),
}));

vi.mock("@/lib/server/veld-score", () => ({
  getLatestByCamp: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/server/feed-on-offer", () => ({
  getLatestCoverByCamp: vi.fn().mockResolvedValue(new Map()),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

import type { SessionFarm } from "@/types/next-auth";
import type { FarmOverview } from "@/lib/server/multi-farm-overview";

const MOCK_FARMS: SessionFarm[] = [
  { slug: "farm-alpha", displayName: "Farm Alpha", role: "owner", logoUrl: null, tier: "advanced", subscriptionStatus: "active" },
  { slug: "farm-beta", displayName: "Farm Beta", role: "owner", logoUrl: null, tier: "basic", subscriptionStatus: "active" },
];

const MOCK_OVERVIEWS: FarmOverview[] = MOCK_FARMS.map((f) => ({
  slug: f.slug,
  activeAnimalCount: 42,
  campCount: 5,
  lastObservationAt: null,
  tier: f.tier,
  subscriptionStatus: f.subscriptionStatus,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getCachedMultiFarmOverview — DB call savings", () => {
  beforeEach(() => {
    _cache.clear();
    _tagIndex.clear();
    _fetcherCallCount = 0;
  });

  it("cold hit: getOverviewForUserFarms is called once on first invocation", async () => {
    const { getCachedMultiFarmOverview } = await import("@/lib/server/cached");

    const coldStart = performance.now();
    const result = await getCachedMultiFarmOverview(USER_ID, MOCK_FARMS);
    const coldMs = performance.now() - coldStart;

    expect(_fetcherCallCount).toBe(1);
    expect(coldMs).toBeGreaterThanOrEqual(SIMULATED_DB_LATENCY_MS);
    expect(result).toHaveLength(MOCK_FARMS.length);
  });

  it(`warm hits: ${N_REQUESTS - 1} subsequent calls do NOT invoke getOverviewForUserFarms`, async () => {
    const { getCachedMultiFarmOverview } = await import("@/lib/server/cached");

    // Cold hit — populates cache
    await getCachedMultiFarmOverview(USER_ID, MOCK_FARMS);
    expect(_fetcherCallCount).toBe(1);

    // Warm hits — should serve entirely from cache
    const warmStart = performance.now();
    for (let i = 1; i < N_REQUESTS; i++) {
      await getCachedMultiFarmOverview(USER_ID, MOCK_FARMS);
    }
    const warmTotalMs = performance.now() - warmStart;

    // Fetcher must NOT have been called again
    expect(_fetcherCallCount).toBe(1);

    // Warm requests should be substantially faster than a cold DB fetch
    const averageWarmMs = warmTotalMs / (N_REQUESTS - 1);
    expect(averageWarmMs).toBeLessThan(SIMULATED_DB_LATENCY_MS);

    console.log(
      `[perf] Multi-farm overview cold: 1 fetcher call (${MOCK_FARMS.length} farms × 3 queries). ` +
        `Warm ×${N_REQUESTS - 1}: 0 additional calls, avg ${averageWarmMs.toFixed(2)}ms/req.`,
    );
  });

  it("warm hit returns identical object reference (no cache poisoning)", async () => {
    const { getCachedMultiFarmOverview } = await import("@/lib/server/cached");

    const cold = await getCachedMultiFarmOverview(USER_ID, MOCK_FARMS);
    const warm = await getCachedMultiFarmOverview(USER_ID, MOCK_FARMS);

    // Referential equality — same object from cache
    expect(warm).toBe(cold);
  });

  it("different userIds get independent cache entries", async () => {
    const { getCachedMultiFarmOverview } = await import("@/lib/server/cached");

    await getCachedMultiFarmOverview("user-aaa", MOCK_FARMS);
    expect(_fetcherCallCount).toBe(1);

    await getCachedMultiFarmOverview("user-bbb", MOCK_FARMS);
    expect(_fetcherCallCount).toBe(2);
  });

  it("tagged revalidation clears the cache entry (simulates animal write)", async () => {
    const { getCachedMultiFarmOverview } = await import("@/lib/server/cached");
    const { revalidateTag } = await import("next/cache");

    // Populate cache
    await getCachedMultiFarmOverview(USER_ID, MOCK_FARMS);
    expect(_fetcherCallCount).toBe(1);

    // Warm hit confirms cache is hot
    await getCachedMultiFarmOverview(USER_ID, MOCK_FARMS);
    expect(_fetcherCallCount).toBe(1);

    // Simulate an animal write invalidating the first farm's animals tag
    revalidateTag(`farm-${MOCK_FARMS[0].slug}-animals`, "max");

    // Next call should re-fetch from DB
    await getCachedMultiFarmOverview(USER_ID, MOCK_FARMS);
    expect(_fetcherCallCount).toBe(2);
  });
});
