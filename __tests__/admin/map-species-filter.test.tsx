// @vitest-environment jsdom
/**
 * __tests__/admin/map-species-filter.test.tsx
 *
 * FarmMode behaviour of the map surfaces.
 *
 *   - `/[farmSlug]/dashboard`   → DashboardClient receives camps via
 *                                  `getCachedDashboardData`, cut to the
 *                                  active species in-memory.
 *   - `/[farmSlug]/admin/map`   → camp.findMany goes through the
 *                                  `crossSpecies(prisma, ...)` door — the
 *                                  admin map shows EVERY camp regardless of
 *                                  FarmMode (issue #364: a physical camp
 *                                  grazes whatever species is on it; camps
 *                                  are not a per-species concept). Wave 233
 *                                  originally routed this through `scoped()`
 *                                  and #364 reclassified it.
 *
 * The structural arch test
 * `__tests__/architecture/species-access-no-direct-prisma.test.ts`
 * (ADR-0005) enforces that camp reads use a named door — either door is
 * compliant; the choice between them is a domain decision.
 */
import type React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

const campFindManyMock = vi.fn();
const animalGroupByMock = vi.fn();
const animalCountMock = vi.fn();
const farmSettingsFindFirstMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getFarmCredsMock = vi.fn();
const getSessionMock = vi.fn();
const getCensusPopulationByCampMock = vi.fn();
const getRotationStatusByCampMock = vi.fn();
const getLatestByCampMock = vi.fn();
const getLatestCoverByCampMock = vi.fn();
const withFarmPrismaMock = vi.fn();
const getCachedDashboardDataMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b/admin/map",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  withFarmPrisma: withFarmPrismaMock,
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/meta-db", () => ({ getFarmCreds: getFarmCredsMock }));
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/species/game/analytics", () => ({
  getCensusPopulationByCamp: getCensusPopulationByCampMock,
}));
vi.mock("@/lib/server/rotation-engine", () => ({
  getRotationStatusByCamp: getRotationStatusByCampMock,
}));
vi.mock("@/lib/server/veld-score", () => ({
  getLatestByCamp: getLatestByCampMock,
}));
vi.mock("@/lib/server/feed-on-offer", () => ({
  getLatestCoverByCamp: getLatestCoverByCampMock,
}));
vi.mock("@/lib/server/cached", () => ({
  getCachedDashboardData: getCachedDashboardDataMock,
}));

// Heavy client components — we only care about the prisma calls + the
// camps prop handed to the client.
const dashboardClientCalls: Array<{ camps: Array<{ camp_id: string }> }> = [];
const adminMapClientCalls: Array<{
  campData: Array<{ camp: { camp_id: string } }>;
}> = [];

vi.mock("@/components/dashboard/DashboardClient", () => ({
  default: (props: { camps: Array<{ camp_id: string }> }) => {
    dashboardClientCalls.push({ camps: props.camps });
    return null;
  },
}));
vi.mock("@/app/[farmSlug]/admin/map/AdminMapClient", () => ({
  default: (props: { campData: Array<{ camp: { camp_id: string } }> }) => {
    adminMapClientCalls.push({ campData: props.campData });
    return null;
  },
}));

// Fixture: 10 cattle camps + 5 sheep camps (15 total).
const FIXTURE_CAMPS = [
  ...Array.from({ length: 10 }, (_, i) => ({
    campId: `cattle-camp-${i + 1}`,
    campName: `Cattle Camp ${i + 1}`,
    sizeHectares: 10,
    waterSource: "borehole",
    geojson: null,
    color: null,
    species: "cattle" as const,
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    campId: `sheep-camp-${i + 1}`,
    campName: `Sheep Camp ${i + 1}`,
    sizeHectares: 5,
    waterSource: "trough",
    geojson: null,
    color: null,
    species: "sheep" as const,
  })),
];

function buildPrismaMock() {
  return {
    camp: { findMany: campFindManyMock },
    animal: { groupBy: animalGroupByMock, count: animalCountMock },
    farmSettings: { findFirst: farmSettingsFindFirstMock },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dashboardClientCalls.length = 0;
  adminMapClientCalls.length = 0;
  getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
  getSessionMock.mockResolvedValue({
    user: { email: "luc@example.com" },
  });
  getPrismaForFarmMock.mockResolvedValue(buildPrismaMock());
  // withFarmPrisma → invoke the callback with the same prisma mock.
  withFarmPrismaMock.mockImplementation(
    async (_slug: string, fn: (p: unknown) => Promise<unknown>) =>
      fn(buildPrismaMock()),
  );
  // The facade enforces `species: mode` injection. Mock implementation:
  // return only camps matching the requested species.
  campFindManyMock.mockImplementation(async (args?: {
    where?: { species?: string };
  }) => {
    const species = args?.where?.species;
    if (!species) {
      // Cross-species call — return everything (cached dashboard data).
      return FIXTURE_CAMPS;
    }
    return FIXTURE_CAMPS.filter((c) => c.species === species);
  });
  animalGroupByMock.mockResolvedValue([]);
  animalCountMock.mockResolvedValue(0);
  farmSettingsFindFirstMock.mockResolvedValue({ latitude: -33, longitude: 22 });
  getCensusPopulationByCampMock.mockResolvedValue([]);
  getRotationStatusByCampMock.mockResolvedValue({ camps: [] });
  getLatestByCampMock.mockResolvedValue(new Map());
  getLatestCoverByCampMock.mockResolvedValue(new Map());

  // getCachedDashboardData returns the FULL cross-species camp list (cache
  // is keyed per-farm, not per-mode — see lib/server/cached.ts JSDoc). Wave
  // 233 threads `species` through the Camp DTO so the dashboard page can
  // filter in-memory without a second Prisma round-trip.
  getCachedDashboardDataMock.mockResolvedValue({
    totalAll: 15,
    totalBySpecies: { cattle: 10, sheep: 5 },
    campAnimalCounts: {},
    campCountsBySpecies: { cattle: {}, sheep: {} },
    camps: FIXTURE_CAMPS.map((c) => ({
      camp_id: c.campId,
      camp_name: c.campName,
      size_hectares: c.sizeHectares,
      water_source: c.waterSource,
      species: c.species,
    })),
    latitude: -33,
    longitude: 22,
    censusCountByCamp: {},
    rotationByCampId: {},
    veldScoreByCamp: {},
    feedOnOfferKgDmPerHaByCamp: {},
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("#364 — admin/map page shows every camp regardless of FarmMode", () => {
  it("cattle mode → all 15 camps are rendered on the admin map", async () => {
    getFarmModeMock.mockResolvedValue("cattle");
    const { default: AdminMapPage } = await import(
      "@/app/[farmSlug]/admin/map/page"
    );
    const tree = await AdminMapPage({
      params: Promise.resolve({ farmSlug: "trio-b" }),
    });
    render(tree as React.ReactElement);

    // The camp read goes through the cross-species door — no `where.species`
    // predicate is injected (issue #364).
    expect(campFindManyMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of campFindManyMock.mock.calls) {
      const where = (call[0] as { where?: { species?: string } })?.where;
      expect(where?.species).toBeUndefined();
    }

    // The client receives every camp — both cattle and sheep.
    expect(adminMapClientCalls.length).toBe(1);
    expect(adminMapClientCalls[0].campData.length).toBe(15);
  });

  it("sheep mode → all 15 camps are still rendered on the admin map", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    const { default: AdminMapPage } = await import(
      "@/app/[farmSlug]/admin/map/page"
    );
    const tree = await AdminMapPage({
      params: Promise.resolve({ farmSlug: "trio-b" }),
    });
    render(tree as React.ReactElement);

    for (const call of campFindManyMock.mock.calls) {
      const where = (call[0] as { where?: { species?: string } })?.where;
      expect(where?.species).toBeUndefined();
    }

    // Sheep mode must NOT hide the cattle camps — this is the #364 bug.
    expect(adminMapClientCalls.length).toBe(1);
    expect(adminMapClientCalls[0].campData.length).toBe(15);
  });
});

describe("Wave 233 — dashboard page filters map camps by FarmMode", () => {
  it("cattle mode → DashboardClient receives only the 10 cattle camps", async () => {
    getFarmModeMock.mockResolvedValue("cattle");
    const { default: DashboardPage } = await import(
      "@/app/[farmSlug]/dashboard/page"
    );
    const tree = await DashboardPage({
      params: Promise.resolve({ farmSlug: "trio-b" }),
    });
    render(tree as React.ReactElement);

    // Phase-F contract: the dashboard page MUST NOT touch raw Prisma
    // (cache-flag-removal regression guard). The species filter is an
    // in-memory cut over `getCachedDashboardData().camps`, which threads
    // `species` through the Camp DTO (lib/types.ts + lib/server/cached.ts).
    expect(campFindManyMock).not.toHaveBeenCalled();

    expect(dashboardClientCalls.length).toBe(1);
    const camps = dashboardClientCalls[0].camps;
    expect(camps.length).toBe(10);
    expect(camps.every((c) => c.camp_id.startsWith("cattle-"))).toBe(true);
  });

  it("sheep mode → DashboardClient receives only the 5 sheep camps", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    const { default: DashboardPage } = await import(
      "@/app/[farmSlug]/dashboard/page"
    );
    const tree = await DashboardPage({
      params: Promise.resolve({ farmSlug: "trio-b" }),
    });
    render(tree as React.ReactElement);

    expect(campFindManyMock).not.toHaveBeenCalled();

    expect(dashboardClientCalls.length).toBe(1);
    const camps = dashboardClientCalls[0].camps;
    expect(camps.length).toBe(5);
    expect(camps.every((c) => c.camp_id.startsWith("sheep-"))).toBe(true);
  });
});
