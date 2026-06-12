// @vitest-environment jsdom
/**
 * __tests__/app/admin-camps-crossspecies.test.tsx
 *
 * S25 (sp-M1) — `/admin/camps` is a cross-species surface.
 *
 * Camps are CROSS-species infrastructure: a physical camp grazes whatever
 * species is on it, regardless of the user's active FarmMode. ADR-0005 made
 * `crossSpecies("farm-wide-audit")` the canonical door for camp-list reads
 * (PR #373 / #364 on the map pages, #390 on the three camp-by-id surfaces).
 * The `/admin/camps` listing page was the divergent outlier still routing
 * through `scoped(prisma, mode)` — on a multi-species tenant it
 * under-reported the camp list to whichever species the FarmMode cookie
 * happened to hold.
 *
 * Locking contract (same shape as `map-camps-crossspecies.test.tsx`):
 *   1. The page's camp.findMany carries no `where.species` predicate.
 *   2. Every camp reaches the table regardless of the active FarmMode.
 *   3. The camp list is FarmMode-invariant.
 *   4. Single-species farms see the exact same rows as before (no
 *      regression — acceptance criterion 2 of S25).
 *
 * NOTE: the per-species namespace page (`/[slug]/sheep/camps`) is
 * INTENTIONALLY species-scoped (`camps-empty-state.test.tsx` locks that);
 * this contract applies to the shared-infrastructure admin surface only.
 */
import type React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

const campFindManyMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getFarmCredsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b/admin/camps",
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
vi.mock("@/lib/server/veld-score", () => ({ getFarmSummary: vi.fn() }));
vi.mock("@/lib/server/feed-on-offer", () => ({
  getFarmFeedOnOfferPayload: vi.fn(),
}));

// Heavy children — record only the camps prop handed to the table.
const campsTableCalls: Array<{ camps: Array<{ camp_id: string }> }> = [];

vi.mock("@/components/admin/AddCampForm", () => ({ default: () => null }));
vi.mock("@/components/admin/CampsTable", () => ({
  default: (props: { camps: Array<{ camp_id: string }> }) => {
    campsTableCalls.push({ camps: props.camps });
    return null;
  },
}));
vi.mock("@/components/admin/CampAnalyticsSection", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/PerformanceSection", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/RainfallSection", () => ({ default: () => null }));
vi.mock("@/components/admin/rotation/RotationSection", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/CampsTabBar", () => ({ default: () => null }));
vi.mock("@/components/admin/UpgradePrompt", () => ({ default: () => null }));
vi.mock("@/components/admin/camps/VeldTab", () => ({ VeldTab: () => null }));
vi.mock("@/components/admin/camps/FeedOnOfferTab", () => ({
  FeedOnOfferTab: () => null,
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

let fixtureCamps = FIXTURE_CAMPS;

beforeEach(() => {
  vi.clearAllMocks();
  campsTableCalls.length = 0;
  fixtureCamps = FIXTURE_CAMPS;
  getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
  getPrismaForFarmMock.mockResolvedValue({
    camp: { findMany: campFindManyMock },
  });
  // Faithful Prisma semantics: a `where.species` predicate filters the
  // result; absence of one returns every camp (the cross-species read).
  campFindManyMock.mockImplementation(
    async (args?: { where?: { species?: string } }) => {
      const species = args?.where?.species;
      if (!species) return fixtureCamps;
      return fixtureCamps.filter((c) => c.species === species);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderAdminCamps() {
  const { default: Page } = await import("@/app/[farmSlug]/admin/camps/page");
  const tree = await Page({
    params: Promise.resolve({ farmSlug: "trio-b" }),
    searchParams: Promise.resolve({}),
  });
  render(tree as React.ReactElement);
}

describe("S25 (sp-M1) — /admin/camps reads the camp list cross-species", () => {
  it("camp.findMany carries no where.species predicate", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    await renderAdminCamps();

    expect(campFindManyMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of campFindManyMock.mock.calls) {
      const where = (call[0] as { where?: { species?: string } })?.where;
      expect(where?.species).toBeUndefined();
    }
  });

  it("hands all 19 camps to the table in cattle FarmMode", async () => {
    getFarmModeMock.mockResolvedValue("cattle");
    await renderAdminCamps();

    expect(campsTableCalls.length).toBe(1);
    expect(campsTableCalls[0].camps.length).toBe(19);
  });

  it("hands all 19 camps to the table in sheep FarmMode (the bug)", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    await renderAdminCamps();

    expect(campsTableCalls.length).toBe(1);
    expect(campsTableCalls[0].camps.length).toBe(19);
  });

  it("camp list is FarmMode-invariant", async () => {
    getFarmModeMock.mockResolvedValue("cattle");
    await renderAdminCamps();
    const cattleIds = campsTableCalls[0].camps
      .map((c) => c.camp_id)
      .sort();

    cleanup();
    campsTableCalls.length = 0;

    getFarmModeMock.mockResolvedValue("sheep");
    await renderAdminCamps();
    const sheepIds = campsTableCalls[0].camps.map((c) => c.camp_id).sort();

    expect(sheepIds).toEqual(cattleIds);
  });

  it("single-species farm sees the same rows as before (no regression)", async () => {
    fixtureCamps = FIXTURE_CAMPS.filter((c) => c.species === "cattle");
    getFarmModeMock.mockResolvedValue("cattle");
    await renderAdminCamps();

    expect(campsTableCalls.length).toBe(1);
    expect(campsTableCalls[0].camps.map((c) => c.camp_id).sort()).toEqual(
      fixtureCamps.map((c) => c.campId).sort(),
    );
  });
});
