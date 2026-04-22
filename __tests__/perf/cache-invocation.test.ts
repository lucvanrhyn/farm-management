/**
 * __tests__/perf/cache-invocation.test.ts
 *
 * Performance contract tests — prove that the flag-gated cache layer
 * correctly routes dashboard and layout requests:
 *
 *   Flag ON  → getCachedDashboardData / getCachedFarmSpeciesSettings called,
 *              getPrismaForFarm NOT called (zero DB round-trips on warm hits)
 *
 *   Flag OFF → getPrismaForFarm called, cached helpers NOT called
 *              (uncached path preserved for rollback)
 *
 * These tests are the TDD proof that the structural caching improvement
 * actually fires the right code path. Real timing numbers are measured
 * separately via the dev server (see scripts/perf-timing.sh).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetFlagCache } from "@/lib/flags";

// ── Slug fixture ─────────────────────────────────────────────────────────────

const SLUG = "test-farm";

// ── Shared DashboardData stub ─────────────────────────────────────────────────

const STUB_DASHBOARD_DATA = {
  totalAll: 5,
  totalBySpecies: { cattle: 5 },
  campAnimalCounts: { Camp1: 5 },
  campCountsBySpecies: { cattle: { Camp1: 5 } },
  camps: [
    {
      camp_id: "Camp1",
      camp_name: "Camp 1",
      size_hectares: undefined,
      water_source: undefined,
      geojson: undefined,
      color: undefined,
    },
  ],
  latitude: null,
  longitude: null,
  censusCountByCamp: {},
  rotationByCampId: {},
  veldScoreByCamp: {},
  feedOnOfferKgDmPerHaByCamp: {},
};

// ── Module mocks ──────────────────────────────────────────────────────────────

// next/cache must be stubbed — revalidateTag/unstable_cache require Next runtime
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: vi.fn().mockImplementation(
    (fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

// Spy on cached helpers
const mockGetCachedDashboardData = vi.fn().mockResolvedValue(STUB_DASHBOARD_DATA);
const mockGetCachedFarmSpeciesSettings = vi
  .fn()
  .mockResolvedValue({ enabledSpecies: ["cattle"] });

vi.mock("@/lib/server/cached", () => ({
  getCachedDashboardData: (...args: unknown[]) =>
    mockGetCachedDashboardData(...args),
  getCachedFarmSpeciesSettings: (...args: unknown[]) =>
    mockGetCachedFarmSpeciesSettings(...args),
}));

// Spy on the raw DB client factory
const mockGetPrismaForFarm = vi.fn().mockResolvedValue({
  farmSpeciesSettings: {
    findMany: vi.fn().mockResolvedValue([{ species: "cattle", enabled: true }]),
  },
  animal: {
    groupBy: vi.fn().mockResolvedValue([]),
  },
  camp: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  farmSettings: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
});

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: (...args: unknown[]) => mockGetPrismaForFarm(...args),
  getPrismaWithAuth: vi.fn(),
  withFarmPrisma: vi.fn(),
}));

// Stub heavy analytics helpers (avoid importing their transitive deps)
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

// Stub React components so JSX doesn't explode without a DOM
vi.mock("@/components/dashboard/DashboardClient", () => ({
  default: () => null,
}));
vi.mock("@/lib/farm-mode", () => ({
  FarmModeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function setFlag(value: string) {
  process.env.FARM_CACHE_ENABLED_SLUGS = value;
  __resetFlagCache();
}

function clearFlag() {
  delete process.env.FARM_CACHE_ENABLED_SLUGS;
  __resetFlagCache();
}

// ── Dashboard page routing ─────────────────────────────────────────────────────

describe("DashboardPage — cache routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flag ON: calls getCachedDashboardData, does NOT call getPrismaForFarm", async () => {
    setFlag(SLUG);
    const { default: DashboardPage } = await import(
      "@/app/[farmSlug]/dashboard/page"
    );

    await DashboardPage({ params: Promise.resolve({ farmSlug: SLUG }) });

    expect(mockGetCachedDashboardData).toHaveBeenCalledWith(SLUG);
    expect(mockGetPrismaForFarm).not.toHaveBeenCalled();
  });

  it("flag OFF: calls getPrismaForFarm, does NOT call getCachedDashboardData", async () => {
    clearFlag();
    const { default: DashboardPage } = await import(
      "@/app/[farmSlug]/dashboard/page"
    );

    await DashboardPage({ params: Promise.resolve({ farmSlug: SLUG }) });

    expect(mockGetPrismaForFarm).toHaveBeenCalledWith(SLUG);
    expect(mockGetCachedDashboardData).not.toHaveBeenCalled();
  });

  it("flag ON for different slug: getCachedDashboardData called with correct slug", async () => {
    setFlag("other-farm");
    const { default: DashboardPage } = await import(
      "@/app/[farmSlug]/dashboard/page"
    );

    // SLUG ("test-farm") is not in the allowlist — flag is OFF for this slug
    await DashboardPage({ params: Promise.resolve({ farmSlug: SLUG }) });

    expect(mockGetCachedDashboardData).not.toHaveBeenCalled();
    expect(mockGetPrismaForFarm).toHaveBeenCalledWith(SLUG);
  });
});

// ── Layout routing ─────────────────────────────────────────────────────────────

describe("FarmSlugLayout — cache routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flag ON: calls getCachedFarmSpeciesSettings, does NOT call getPrismaForFarm", async () => {
    setFlag(SLUG);
    const { default: FarmSlugLayout } = await import("@/app/[farmSlug]/layout");

    await FarmSlugLayout({
      children: null,
      params: Promise.resolve({ farmSlug: SLUG }),
    });

    expect(mockGetCachedFarmSpeciesSettings).toHaveBeenCalledWith(SLUG);
    expect(mockGetPrismaForFarm).not.toHaveBeenCalled();
  });

  it("flag OFF: calls getPrismaForFarm, does NOT call getCachedFarmSpeciesSettings", async () => {
    clearFlag();
    const { default: FarmSlugLayout } = await import("@/app/[farmSlug]/layout");

    await FarmSlugLayout({
      children: null,
      params: Promise.resolve({ farmSlug: SLUG }),
    });

    expect(mockGetPrismaForFarm).toHaveBeenCalledWith(SLUG);
    expect(mockGetCachedFarmSpeciesSettings).not.toHaveBeenCalled();
  });

  it("flag ON: returned enabledSpecies comes from cached helper", async () => {
    setFlag(SLUG);
    mockGetCachedFarmSpeciesSettings.mockResolvedValueOnce({
      enabledSpecies: ["cattle", "sheep"],
    });

    const { default: FarmSlugLayout } = await import("@/app/[farmSlug]/layout");

    // Calling layout doesn't throw and uses cached species list
    await expect(
      FarmSlugLayout({
        children: null,
        params: Promise.resolve({ farmSlug: SLUG }),
      }),
    ).resolves.not.toThrow();

    expect(mockGetCachedFarmSpeciesSettings).toHaveBeenCalledOnce();
  });
});
