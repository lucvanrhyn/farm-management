/**
 * __tests__/server/dashboard-overview-mode-cache.test.ts
 *
 * Issue #225 — admin dashboard home filters by FarmMode.
 *
 * Regression lock: getCachedDashboardOverview MUST include `mode` in the
 * cache key, OR cattle and sheep dashboards share one cache entry and
 * the second-mode call returns the first-mode numbers.
 *
 * The pattern follows __tests__/perf/multi-farm-cache.test.ts — a
 * Map-backed unstable_cache mock that lets us count fetcher invocations.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory cache mirror of next/cache ─────────────────────────────────────
//
// Same shape as the multi-farm-cache.test.ts mock: keys are JSON-serialised
// keyParts + args, so a cache hit happens iff all args (incl. mode) match.

const _cache = new Map<string, unknown>();
const _tagIndex = new Map<string, Set<string>>();
let _fetcherCallCount = 0;

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn((tag: string) => {
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

// ── Per-mode count stub used by withFarmPrisma ───────────────────────────────
//
// The Animal `count` mock returns different numbers per species so we can
// assert the fetcher *result* differs across modes. The Prisma facade
// (scoped(prisma, mode)) merges `{ species: mode, ... }` into the where
// clause and forwards to the underlying delegate — we read that out here.

const MODE_TO_ACTIVE_COUNT: Record<string, number> = {
  cattle: 10,
  sheep: 5,
  game: 3,
};

vi.mock("@/lib/farm-prisma", () => ({
  withFarmPrisma: vi.fn(async (_slug: string, fn: (p: unknown) => Promise<unknown>) => {
    const prisma = {
      animal: {
        count: vi.fn(async (args: { where?: { species?: string } } | undefined) => {
          // Facade injects `where: { species: mode }` for per-species counts.
          // Cross-species call sites (no species predicate) get 0 in this stub.
          const species = args?.where?.species;
          const n = species ? MODE_TO_ACTIVE_COUNT[species] ?? 0 : 0;
          _fetcherCallCount++;
          return n;
        }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      camp: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
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
  }),
  getPrismaForFarm: vi.fn(),
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// ── Stub every downstream helper getCachedDashboardOverview pulls in ─────────
//
// We mock the helpers to return zero/empty payloads so the test focuses on
// the cache-key axis (mode), not on the helpers' internal semantics. Each
// helper that the fix threads `mode` through is mocked here so the test can
// also assert mode reached the helper boundary.

const _getReproStatsMock = vi.fn().mockResolvedValue({
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
});

vi.mock("@/lib/server/reproduction-analytics", () => ({
  getReproStats: _getReproStatsMock,
}));

const _countHealthIssuesSinceMock = vi.fn().mockResolvedValue(0);
const _countInspectedTodayMock = vi.fn().mockResolvedValue(0);
const _getRecentHealthMock = vi.fn().mockResolvedValue([]);
const _getLowGrazingMock = vi.fn().mockResolvedValue(0);

vi.mock("@/lib/server/camp-status", () => ({
  getLatestCampConditions: vi.fn().mockResolvedValue(new Map()),
  countHealthIssuesSince: _countHealthIssuesSinceMock,
  countInspectedToday: _countInspectedTodayMock,
  getRecentHealthObservations: _getRecentHealthMock,
  getLowGrazingCampCount: _getLowGrazingMock,
}));

const _getDashboardAlertsMock = vi.fn().mockResolvedValue({
  red: [],
  amber: [],
  totalCount: 0,
});

vi.mock("@/lib/server/dashboard-alerts", () => ({
  getDashboardAlerts: _getDashboardAlertsMock,
}));

vi.mock("@/lib/server/data-health", () => ({
  getDataHealthScore: vi.fn().mockResolvedValue({
    overall: 0,
    grade: "D",
    breakdown: {},
  }),
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getCachedDashboardOverview — mode in cache key (issue #225)", () => {
  beforeEach(() => {
    _cache.clear();
    _tagIndex.clear();
    _fetcherCallCount = 0;
    _getReproStatsMock.mockClear();
    _countHealthIssuesSinceMock.mockClear();
    _countInspectedTodayMock.mockClear();
    _getRecentHealthMock.mockClear();
    _getDashboardAlertsMock.mockClear();
  });

  it("returns 10 active cattle when called with mode='cattle'", async () => {
    const { getCachedDashboardOverview } = await import("@/lib/server/cached");
    const result = await getCachedDashboardOverview("farm-x", "cattle");
    expect(result.totalAnimals).toBe(10);
  });

  it("returns 5 active sheep when subsequently called with mode='sheep' (cache key includes mode)", async () => {
    const { getCachedDashboardOverview } = await import("@/lib/server/cached");

    // First call: cattle — populates cache for the cattle key
    const cattle = await getCachedDashboardOverview("farm-x", "cattle");
    expect(cattle.totalAnimals).toBe(10);

    // Second call: sheep — would return cattle's 10 if the cache key
    // collapsed `mode` (the bug this issue closes). With mode in the key,
    // sheep gets its own entry and the underlying count fires for `sheep`.
    const sheep = await getCachedDashboardOverview("farm-x", "sheep");
    expect(sheep.totalAnimals).toBe(5);
  });

  it("re-uses the cattle cache entry on warm cattle calls", async () => {
    const { getCachedDashboardOverview } = await import("@/lib/server/cached");

    await getCachedDashboardOverview("farm-x", "cattle");
    const fetcherCallsAfterCold = _fetcherCallCount;
    expect(fetcherCallsAfterCold).toBeGreaterThan(0);

    // Warm cattle hit — should be served entirely from the cattle cache
    // entry, so the underlying animal.count mock is NOT re-invoked.
    await getCachedDashboardOverview("farm-x", "cattle");
    expect(_fetcherCallCount).toBe(fetcherCallsAfterCold);
  });

  it("threads `mode` through to getReproStats", async () => {
    const { getCachedDashboardOverview } = await import("@/lib/server/cached");
    await getCachedDashboardOverview("farm-x", "sheep");

    // getReproStats is called with the per-species option object.
    expect(_getReproStatsMock).toHaveBeenCalled();
    const lastCall = _getReproStatsMock.mock.calls.at(-1);
    // signature: getReproStats(prisma, { species })
    expect(lastCall?.[1]).toMatchObject({ species: "sheep" });
  });

  it("threads `mode` through to countHealthIssuesSince and countInspectedToday", async () => {
    const { getCachedDashboardOverview } = await import("@/lib/server/cached");
    await getCachedDashboardOverview("farm-x", "sheep");

    // The bug class this guards: pre-fix the dashboard counted health
    // issues across every species. Post-fix the helpers accept `mode`
    // and only count rows for the active species.
    expect(_countHealthIssuesSinceMock).toHaveBeenCalled();
    const healthCall = _countHealthIssuesSinceMock.mock.calls.at(-1);
    // signature: countHealthIssuesSince(prisma, since, mode?)
    expect(healthCall?.[2]).toBe("sheep");

    expect(_countInspectedTodayMock).toHaveBeenCalled();
    const inspectedCall = _countInspectedTodayMock.mock.calls.at(-1);
    // signature: countInspectedToday(prisma, mode?)
    expect(inspectedCall?.[1]).toBe("sheep");
  });

  it("threads `mode` through to getRecentHealthObservations", async () => {
    const { getCachedDashboardOverview } = await import("@/lib/server/cached");
    await getCachedDashboardOverview("farm-x", "game");

    expect(_getRecentHealthMock).toHaveBeenCalled();
    const call = _getRecentHealthMock.mock.calls.at(-1);
    // signature: getRecentHealthObservations(prisma, limit, mode?)
    expect(call?.[2]).toBe("game");
  });

  it("threads `mode` through to getDashboardAlerts", async () => {
    const { getCachedDashboardOverview } = await import("@/lib/server/cached");
    await getCachedDashboardOverview("farm-x", "sheep");

    expect(_getDashboardAlertsMock).toHaveBeenCalled();
    const call = _getDashboardAlertsMock.mock.calls.at(-1);
    // signature: getDashboardAlerts(prisma, slug, thresholds, preFetched?, mode?)
    // mode is the 5th positional arg.
    expect(call?.[4]).toBe("sheep");
  });
});
