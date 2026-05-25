/**
 * __tests__/lib/server/cached.test.ts
 *
 * Issue #414 (parent PRD #412) — Split `getCachedDashboardOverview` along
 * the mode-dependence seam.
 *
 * Why: the prior single fetcher keyed by `(slug, mode)` returned a bundle
 * mixing mode-DEPENDENT fields (animal counts, repro stats — legitimately
 * differ per FarmMode) with mode-INDEPENDENT fields (`totalCamps` from
 * `crossSpecies(prisma).camp.count()`, `inspectedToday`, `dataHealth`).
 * Flipping FarmMode forced a fresh DB read for the whole bundle and the
 * `totalCamps` KPI tile visibly drifted between cattle and sheep views
 * (#411). This split puts mode-independent values behind a `(slug)`-only
 * cache key — same `totalCamps` regardless of active species.
 *
 * These tests use the same key-respecting `unstable_cache` stub pattern
 * as __tests__/server/dashboard-overview-mode-cache.test.ts — keys are
 * JSON-serialised keyParts + args, so a cache hit happens iff all args
 * match the entry's args.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory cache mirror of next/cache ─────────────────────────────────────

const _cache = new Map<string, unknown>();
const _tagIndex = new Map<string, Set<string>>();
const _keyOpts = new Map<string, { revalidate?: number; tags?: string[] }>();

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn((tag: string, _profile?: string) => {
    void _profile;
    const keys = _tagIndex.get(tag);
    if (keys) {
      for (const k of keys) _cache.delete(k);
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
      _keyOpts.set(cacheKey, opts ?? {});
      if (_cache.has(cacheKey)) return _cache.get(cacheKey);
      const result = await fn(...args);
      _cache.set(cacheKey, result);
      for (const tag of opts?.tags ?? []) {
        if (!_tagIndex.has(tag)) _tagIndex.set(tag, new Set());
        _tagIndex.get(tag)!.add(cacheKey);
      }
      return result;
    };
  },
}));

// ── Prisma stub ──────────────────────────────────────────────────────────────
//
// totalAnimals must differ per species (mode-DEPENDENT) — the facade's
// `animal.count({ where: { species } })` reads the species from args.
// camp.count is fixed (mode-INDEPENDENT) — same value regardless of mode.

const MODE_TO_ACTIVE_COUNT: Record<string, number> = {
  cattle: 10,
  sheep: 5,
  game: 3,
};

const _campCountMock = vi.fn().mockResolvedValue(7);

vi.mock("@/lib/farm-prisma", () => ({
  withFarmPrisma: vi.fn(
    async (_slug: string, fn: (p: unknown) => Promise<unknown>) => {
      const prisma = {
        animal: {
          count: vi.fn(async (args: { where?: { species?: string } } | undefined) => {
            const species = args?.where?.species;
            return species ? MODE_TO_ACTIVE_COUNT[species] ?? 0 : 0;
          }),
          groupBy: vi.fn().mockResolvedValue([]),
        },
        camp: {
          findMany: vi.fn().mockResolvedValue([]),
          count: _campCountMock,
        },
        farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
        farmSpeciesSettings: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ species: "cattle", enabled: true }]),
        },
        observation: {
          count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue(null),
        },
        transaction: { findMany: vi.fn().mockResolvedValue([]) },
      };
      return fn(prisma);
    },
  ),
  getPrismaForFarm: vi.fn(),
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// ── Downstream-helper stubs (same shape as #225 / #280 test files) ───────────

vi.mock("@/lib/server/reproduction-analytics", () => ({
  getReproStats: vi.fn().mockResolvedValue({
    pregnancyRate: null,
    calvingRate: null,
    avgCalvingIntervalDays: null,
    upcomingCalvings: [],
    inHeat7d: 0,
    inseminations30d: 0,
    calvingsDue30d: 0,
    scanCounts: { pregnant: 0, empty: 0, uncertain: 0 },
    conceptionRate: null,
    pregnancyRateByCycle: [],
    daysOpen: [],
    avgDaysOpen: null,
    weaningRate: null,
  }),
}));

const _countInspectedTodayMock = vi.fn().mockResolvedValue(4);

vi.mock("@/lib/server/camp-status", () => ({
  getLatestCampConditions: vi.fn().mockResolvedValue(new Map()),
  countHealthIssuesSince: vi.fn().mockResolvedValue(0),
  countInspectedToday: _countInspectedTodayMock,
  getRecentHealthObservations: vi.fn().mockResolvedValue([]),
  getLowGrazingCampCount: vi.fn().mockResolvedValue(2),
}));

vi.mock("@/lib/server/dashboard-alerts", () => ({
  getDashboardAlerts: vi
    .fn()
    .mockResolvedValue({ red: [], amber: [], totalCount: 0 }),
}));

vi.mock("@/lib/server/data-health", () => ({
  getDataHealthScore: vi.fn().mockResolvedValue({
    overall: 0,
    grade: "D",
    breakdown: {},
  }),
}));

vi.mock("@/lib/server/treatment-analytics", () => ({
  getWithdrawalCount: vi.fn().mockResolvedValue(1),
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getCachedDashboardOverviewByMode — keyed by (slug, mode) (#414)", () => {
  beforeEach(() => {
    _cache.clear();
    _tagIndex.clear();
    _keyOpts.clear();
    _campCountMock.mockClear();
  });

  it("returns mode-dependent shape only (no totalCamps / inspectedToday / dataHealth)", async () => {
    const { getCachedDashboardOverviewByMode } = await import("@/lib/server/cached");
    const result = await getCachedDashboardOverviewByMode("farm-x", "cattle");
    // Mode-dependent fields ARE in the payload…
    expect(result).toHaveProperty("totalAnimals");
    expect(result).toHaveProperty("reproStats");
    expect(result).toHaveProperty("recentHealth");
    expect(result).toHaveProperty("deathsToday");
    expect(result).toHaveProperty("birthsToday");
    expect(result).toHaveProperty("mtdTransactions");
    expect(result).toHaveProperty("dashboardAlerts");
    expect(result).toHaveProperty("healthIssuesThisWeek");
    // …mode-independent fields are NOT.
    expect(result).not.toHaveProperty("totalCamps");
    expect(result).not.toHaveProperty("inspectedToday");
    expect(result).not.toHaveProperty("liveConditions");
    expect(result).not.toHaveProperty("lowGrazingCount");
    expect(result).not.toHaveProperty("withdrawalCount");
    expect(result).not.toHaveProperty("dataHealth");
  });

  it("cattle and sheep get DIFFERENT cache entries (mode in key)", async () => {
    const { getCachedDashboardOverviewByMode } = await import("@/lib/server/cached");

    const cattle = await getCachedDashboardOverviewByMode("farm-x", "cattle");
    expect(cattle.totalAnimals).toBe(10);

    // If `mode` collapsed out of the cache key, sheep would return cattle's
    // 10. With mode in the key, sheep gets its own entry → 5.
    const sheep = await getCachedDashboardOverviewByMode("farm-x", "sheep");
    expect(sheep.totalAnimals).toBe(5);
  });

  it("tag set is exactly [farm-<slug>-dashboard]", async () => {
    const { getCachedDashboardOverviewByMode } = await import("@/lib/server/cached");
    await getCachedDashboardOverviewByMode("farm-x", "cattle");

    // Find the cache entry that was just written and read its recorded opts.
    const entry = [..._keyOpts.entries()].find(([k]) =>
      k.includes("dashboard-overview-by-mode"),
    );
    expect(entry).toBeDefined();
    expect(entry![1].tags).toEqual(["farm-farm-x-dashboard"]);
  });
});

describe("getCachedDashboardOverviewShared — keyed by (slug) only (#414)", () => {
  beforeEach(() => {
    _cache.clear();
    _tagIndex.clear();
    _keyOpts.clear();
    _campCountMock.mockClear();
    _countInspectedTodayMock.mockClear();
  });

  it("returns mode-independent shape only (no totalAnimals / reproStats / dashboardAlerts)", async () => {
    const { getCachedDashboardOverviewShared } = await import("@/lib/server/cached");
    const result = await getCachedDashboardOverviewShared("farm-x");
    // Mode-independent fields ARE in the payload…
    expect(result).toHaveProperty("totalCamps");
    expect(result).toHaveProperty("inspectedToday");
    expect(result).toHaveProperty("liveConditions");
    expect(result).toHaveProperty("lowGrazingCount");
    expect(result).toHaveProperty("withdrawalCount");
    expect(result).toHaveProperty("dataHealth");
    // …mode-dependent fields are NOT.
    expect(result).not.toHaveProperty("totalAnimals");
    expect(result).not.toHaveProperty("reproStats");
    expect(result).not.toHaveProperty("recentHealth");
    expect(result).not.toHaveProperty("dashboardAlerts");
    expect(result).not.toHaveProperty("healthIssuesThisWeek");
  });

  it("returns SAME totalCamps across simulated mode flips (cache key has no mode)", async () => {
    // This is the #411 root-cause regression lock: the shared fetcher must
    // NEVER take `mode` as an argument, so the cache entry survives a
    // FarmMode flip and `totalCamps` stays stable on every reload.
    const { getCachedDashboardOverviewShared } = await import("@/lib/server/cached");

    // First "current mode" = cattle. Simulate by pre-flipping mode independently.
    const first = await getCachedDashboardOverviewShared("farm-x");
    expect(first.totalCamps).toBe(7);

    // Second "current mode" = sheep — same call shape, no mode arg. The
    // shared cache entry serves the same totalCamps without re-fetching.
    const second = await getCachedDashboardOverviewShared("farm-x");
    expect(second.totalCamps).toBe(7);

    // The underlying camp.count fired exactly once — the second call hit
    // the cache. This is THE behaviour that fixes #411.
    expect(_campCountMock).toHaveBeenCalledTimes(1);
  });

  it("tag set includes BOTH farm-<slug>-dashboard AND farm-<slug>-camps", async () => {
    const { getCachedDashboardOverviewShared } = await import("@/lib/server/cached");
    await getCachedDashboardOverviewShared("farm-x");

    const entry = [..._keyOpts.entries()].find(([k]) =>
      k.includes("dashboard-overview-shared"),
    );
    expect(entry).toBeDefined();
    const tags = entry![1].tags ?? [];
    expect(tags).toContain("farm-farm-x-dashboard");
    expect(tags).toContain("farm-farm-x-camps");
  });

  it("revalidateTag('farm-<slug>-camps') invalidates the shared entry (read-side #413 fix)", async () => {
    const { getCachedDashboardOverviewShared } = await import("@/lib/server/cached");
    const { revalidateTag } = await import("next/cache");

    await getCachedDashboardOverviewShared("farm-x");
    expect(_campCountMock).toHaveBeenCalledTimes(1);

    // Simulate the camp-inspection-write invalidation reaching the shared
    // fetcher — this is the read-side counterpart of the #413 fix.
    // Next.js 16 `revalidateTag` takes a second "profile" argument.
    revalidateTag("farm-farm-x-camps", "max");

    await getCachedDashboardOverviewShared("farm-x");
    expect(_campCountMock).toHaveBeenCalledTimes(2);
  });
});

describe("Old getCachedDashboardOverview — DELETED (#414)", () => {
  it("no longer exports getCachedDashboardOverview from lib/server/cached", async () => {
    const mod = await import("@/lib/server/cached");
    expect((mod as Record<string, unknown>).getCachedDashboardOverview).toBeUndefined();
  });
});
