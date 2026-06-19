// @vitest-environment jsdom
/**
 * __tests__/app/map-camps-crossspecies.test.tsx
 *
 * Issue #364 — the camp map is a cross-species surface.
 *
 * A physical camp grazes whatever species is on it; camps are NOT
 * per-species. Both map pages — `/[farmSlug]/map` and
 * `/[farmSlug]/admin/map` — must read the camp list through the
 * `crossSpecies()` door, not `scoped()`. On Trio (19 camps tagged
 * `species='cattle'`) switching to sheep FarmMode previously rendered
 * "0 camps" because the `scoped()` door injected `where.species='sheep'`.
 *
 * Locking contract: the camp.findMany call on both map pages must NOT
 * carry a `where.species` predicate, and the camps handed to the client
 * are identical regardless of the active FarmMode.
 */
import type React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

const campFindManyMock = vi.fn();
const animalGroupByMock = vi.fn();
const farmSettingsFindFirstMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getFarmCredsMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b/map",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/meta-db", () => ({ getFarmCreds: getFarmCredsMock }));
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

// Heavy client components — record only the campData prop handed in.
const tenantMapClientCalls: Array<{
  campData: Array<{ camp: { camp_id: string } }>;
}> = [];
const adminMapClientCalls: Array<{
  campData: Array<{ camp: { camp_id: string } }>;
}> = [];

vi.mock("@/app/[farmSlug]/map/TenantMapClient", () => ({
  default: (props: { campData: Array<{ camp: { camp_id: string } }> }) => {
    tenantMapClientCalls.push({ campData: props.campData });
    return null;
  },
}));
vi.mock("@/app/[farmSlug]/admin/map/AdminMapClient", () => ({
  default: (props: { campData: Array<{ camp: { camp_id: string } }> }) => {
    adminMapClientCalls.push({ campData: props.campData });
    return null;
  },
}));

// Fixture mirrors Trio: 14 cattle camps + 5 sheep camps (19 total).
const FIXTURE_CAMPS = [
  ...Array.from({ length: 14 }, (_, i) => ({
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
    // The admin map now rolls up a per-camp head count via animal.groupBy
    // (decorative status panel, desk_3.jpg). It's not part of the #364
    // cross-species camp-list contract under test, so a no-op stub keeps the
    // facade's groupBy wrapper from throwing on the missing delegate.
    animal: { groupBy: animalGroupByMock },
    farmSettings: { findFirst: farmSettingsFindFirstMock },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tenantMapClientCalls.length = 0;
  adminMapClientCalls.length = 0;
  getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
  getSessionMock.mockResolvedValue({ user: { email: "luc@example.com" } });
  getPrismaForFarmMock.mockResolvedValue(buildPrismaMock());
  animalGroupByMock.mockResolvedValue([]);
  farmSettingsFindFirstMock.mockResolvedValue({ latitude: -33, longitude: 22 });
  // Faithful Prisma semantics: a `where.species` predicate filters the
  // result; absence of one returns every camp (the cross-species read).
  campFindManyMock.mockImplementation(async (args?: {
    where?: { species?: string };
  }) => {
    const species = args?.where?.species;
    if (!species) return FIXTURE_CAMPS;
    return FIXTURE_CAMPS.filter((c) => c.species === species);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderTenantMap() {
  const { default: Page } = await import("@/app/[farmSlug]/map/page");
  const tree = await Page({
    params: Promise.resolve({ farmSlug: "trio-b" }),
  });
  render(tree as React.ReactElement);
}

async function renderAdminMap() {
  const { default: Page } = await import("@/app/[farmSlug]/admin/map/page");
  const tree = await Page({
    params: Promise.resolve({ farmSlug: "trio-b" }),
  });
  render(tree as React.ReactElement);
}

describe("#364 — tenant map (/[slug]/map) reads camps cross-species", () => {
  it("camp.findMany carries no where.species predicate", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    await renderTenantMap();

    expect(campFindManyMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of campFindManyMock.mock.calls) {
      const where = (call[0] as { where?: { species?: string } })?.where;
      expect(where?.species).toBeUndefined();
    }
  });

  it("shows all 19 camps in cattle FarmMode", async () => {
    getFarmModeMock.mockResolvedValue("cattle");
    await renderTenantMap();

    expect(tenantMapClientCalls.length).toBe(1);
    expect(tenantMapClientCalls[0].campData.length).toBe(19);
  });

  it("shows all 19 camps in sheep FarmMode (the bug)", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    await renderTenantMap();

    expect(tenantMapClientCalls.length).toBe(1);
    expect(tenantMapClientCalls[0].campData.length).toBe(19);
  });
});

describe("#364 — admin map (/[slug]/admin/map) reads camps cross-species", () => {
  it("camp.findMany carries no where.species predicate", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    await renderAdminMap();

    expect(campFindManyMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of campFindManyMock.mock.calls) {
      const where = (call[0] as { where?: { species?: string } })?.where;
      expect(where?.species).toBeUndefined();
    }
  });

  it("shows all 19 camps in cattle FarmMode", async () => {
    getFarmModeMock.mockResolvedValue("cattle");
    await renderAdminMap();

    expect(adminMapClientCalls.length).toBe(1);
    expect(adminMapClientCalls[0].campData.length).toBe(19);
  });

  it("shows all 19 camps in sheep FarmMode (the bug)", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    await renderAdminMap();

    expect(adminMapClientCalls.length).toBe(1);
    expect(adminMapClientCalls[0].campData.length).toBe(19);
  });
});

describe("#364 — camp list is FarmMode-invariant on both map pages", () => {
  it("tenant map returns the same camp ids in cattle and sheep mode", async () => {
    getFarmModeMock.mockResolvedValue("cattle");
    await renderTenantMap();
    const cattleIds = tenantMapClientCalls[0].campData
      .map((c) => c.camp.camp_id)
      .sort();

    cleanup();
    tenantMapClientCalls.length = 0;

    getFarmModeMock.mockResolvedValue("sheep");
    await renderTenantMap();
    const sheepIds = tenantMapClientCalls[0].campData
      .map((c) => c.camp.camp_id)
      .sort();

    expect(sheepIds).toEqual(cattleIds);
  });

  it("admin map returns the same camp ids in cattle and sheep mode", async () => {
    getFarmModeMock.mockResolvedValue("cattle");
    await renderAdminMap();
    const cattleIds = adminMapClientCalls[0].campData
      .map((c) => c.camp.camp_id)
      .sort();

    cleanup();
    adminMapClientCalls.length = 0;

    getFarmModeMock.mockResolvedValue("sheep");
    await renderAdminMap();
    const sheepIds = adminMapClientCalls[0].campData
      .map((c) => c.camp.camp_id)
      .sort();

    expect(sheepIds).toEqual(cattleIds);
  });
});
