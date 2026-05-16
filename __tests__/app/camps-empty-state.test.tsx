// @vitest-environment jsdom
/**
 * __tests__/app/camps-empty-state.test.tsx
 *
 * Wave 288 (parent PRD #279) — empty-state guidance for a FarmMode with no
 * camps yet.
 *
 * Behaviour locked here:
 *  1. `/sheep/camps` with zero sheep camps renders actionable "no camps
 *     yet — get started" guidance INSTEAD of an empty/headerless table.
 *  2. `/sheep/camps` with sheep camps still renders the camps table (the
 *     empty-state branch must not regress the normal path).
 *  3. The camp query stays species-scoped (`where.species === "sheep"`)
 *     in both the empty and non-empty cases — no FarmMode/species
 *     semantic change.
 *  4. The tenant map page (`/[slug]/map`) with zero camps for the active
 *     FarmMode renders an onboarding empty state instead of mounting the
 *     map client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

const redirectMock = vi.fn((url: string) => {
  const err = new Error(`__REDIRECT__:${url}`) as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${url};307;`;
  throw err;
});

const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getFarmCredsMock = vi.fn();
const getSessionMock = vi.fn();
const campFindManyMock = vi.fn();
const farmSettingsFindFirstMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b/sheep/camps",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/meta-db", () => ({ getFarmCreds: getFarmCredsMock }));
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

// Heavy children we don't care about for this contract.
vi.mock("@/components/admin/AddCampForm", () => ({ default: () => null }));
vi.mock("@/components/admin/CampAnalyticsSection", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/CampsTable", () => ({
  default: () => <div data-testid="camps-table" />,
}));
vi.mock("@/app/[farmSlug]/map/TenantMapClient", () => ({
  default: () => <div data-testid="tenant-map-client" />,
}));

function buildPrismaMock() {
  return {
    camp: { findMany: campFindManyMock },
    farmSettings: { findFirst: farmSettingsFindFirstMock },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getFarmModeMock.mockResolvedValue("sheep");
  getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
  getSessionMock.mockResolvedValue({ user: { name: "luc" } });
  getPrismaForFarmMock.mockResolvedValue(buildPrismaMock());
  farmSettingsFindFirstMock.mockResolvedValue({ latitude: -33, longitude: 22 });
  campFindManyMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

async function renderSheepCamps() {
  const mod = await import("@/app/[farmSlug]/sheep/camps/page");
  const Page = mod.default as (props: {
    params: Promise<{ farmSlug: string }>;
  }) => Promise<JSX.Element>;
  const ui = await Page({ params: Promise.resolve({ farmSlug: "trio-b" }) });
  render(ui);
}

async function renderTenantMap() {
  const mod = await import("@/app/[farmSlug]/map/page");
  const Page = mod.default as (props: {
    params: Promise<{ farmSlug: string }>;
  }) => Promise<JSX.Element>;
  const ui = await Page({ params: Promise.resolve({ farmSlug: "trio-b" }) });
  render(ui);
}

describe("/sheep/camps empty state (#288)", () => {
  it("renders 'no camps yet — get started' guidance when zero sheep camps exist", async () => {
    campFindManyMock.mockResolvedValue([]);

    await renderSheepCamps();

    expect(screen.queryByTestId("camps-table")).toBeNull();
    expect(screen.getByTestId("camps-empty-state")).toBeTruthy();
    expect(screen.getByText(/no.*camps.*yet/i)).toBeTruthy();
    // Empty-state query stayed species-scoped.
    for (const call of campFindManyMock.mock.calls) {
      expect(call[0]?.where?.species).toBe("sheep");
    }
  });

  it("renders the camps table (not the empty state) when sheep camps exist", async () => {
    campFindManyMock.mockResolvedValue([
      {
        campId: "C2",
        campName: "Lambing Paddock",
        species: "sheep",
        sizeHectares: 12,
        waterSource: "Dam",
        geojson: null,
        color: null,
      },
    ]);

    await renderSheepCamps();

    expect(screen.getByTestId("camps-table")).toBeTruthy();
    expect(screen.queryByTestId("camps-empty-state")).toBeNull();
    for (const call of campFindManyMock.mock.calls) {
      expect(call[0]?.where?.species).toBe("sheep");
    }
  });
});

describe("/[slug]/map empty state (#288)", () => {
  it("renders an onboarding empty state instead of the map when zero camps exist for the active FarmMode", async () => {
    campFindManyMock.mockResolvedValue([]);

    await renderTenantMap();

    expect(screen.queryByTestId("tenant-map-client")).toBeNull();
    expect(screen.getByTestId("map-empty-state")).toBeTruthy();
    expect(screen.getByText(/no.*camps.*yet/i)).toBeTruthy();
    for (const call of campFindManyMock.mock.calls) {
      expect(call[0]?.where?.species).toBe("sheep");
    }
  });

  it("mounts the map client when camps exist for the active FarmMode", async () => {
    campFindManyMock.mockResolvedValue([
      {
        campId: "C2",
        campName: "Lambing Paddock",
        species: "sheep",
        sizeHectares: 12,
        waterSource: "Dam",
        geojson: null,
        color: null,
      },
    ]);

    await renderTenantMap();

    expect(screen.getByTestId("tenant-map-client")).toBeTruthy();
    expect(screen.queryByTestId("map-empty-state")).toBeNull();
  });
});
