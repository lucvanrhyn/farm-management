// @vitest-environment jsdom
/**
 * __tests__/admin/animals-page-pagination.test.tsx
 *
 * Integration-style proof that the admin/animals server page renders at most
 * 50 rows in its initial SSR payload even when the tenant has ~200 animals,
 * exposes a "Load more" control, and that the control hits the existing
 * paginated /api/animals endpoint with a cursor pointing at the last row.
 *
 * The page is a Server Component — we exercise it by invoking the exported
 * async function directly with a mocked `params` promise. All external
 * dependencies are stubbed via `vi.mock`: Prisma, species/mode helper,
 * treatment analytics, and the Suspense-lazy analytics section.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

const animalFindManyMock = vi.fn();
const animalCountMock = vi.fn();
const campFindManyMock = vi.fn();
const mobFindManyMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getAnimalsInWithdrawalMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/delta-livestock/admin/animals",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/farm-prisma", () => ({ getPrismaForFarm: getPrismaForFarmMock, wrapPrismaWithRetry: (_slug: string, client: unknown) => client }));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/server/treatment-analytics", () => ({
  getAnimalsInWithdrawal: getAnimalsInWithdrawalMock,
}));

// The analytics section spawns its own Prisma calls via Suspense; stub it
// out so the test doesn't need the deeper mock graph.
vi.mock("@/components/admin/AnimalAnalyticsSection", () => ({
  default: () => <div data-testid="analytics-section-stub" />,
}));
vi.mock("@/components/admin/ClearSectionButton", () => ({
  default: () => <div data-testid="clear-section-stub" />,
}));
vi.mock("@/components/admin/RecordBirthButton", () => ({
  default: () => <div data-testid="record-birth-stub" />,
}));
vi.mock("@/components/admin/ExportButton", () => ({
  default: () => <div data-testid="export-stub" />,
}));
vi.mock("@/lib/farm-mode", () => ({
  useFarmModeSafe: () => ({ mode: "cattle" }),
}));

type AnyAnimal = {
  id: string;
  animalId: string;
  name: string | null;
  sex: string;
  dateOfBirth: string | null;
  breed: string | null;
  category: string;
  currentCamp: string;
  status: string;
  motherId: string | null;
  fatherId: string | null;
  species: string;
  dateAdded: string;
  mobId: string | null;
  deceasedAt: string | null;
};

function fakeAnimals(n: number): AnyAnimal[] {
  return Array.from({ length: n }, (_, i) => {
    const id = `C${String(i + 1).padStart(4, "0")}`;
    return {
      id,
      animalId: id,
      name: null,
      sex: i % 2 === 0 ? "Female" : "Male",
      dateOfBirth: "2020-01-01",
      breed: "Bonsmara",
      category: "cow",
      currentCamp: "camp-1",
      status: "Active",
      motherId: null,
      fatherId: null,
      species: "cattle",
      dateAdded: "2024-01-01",
      mobId: null,
      deceasedAt: null,
    };
  });
}

beforeEach(() => {
  animalFindManyMock.mockReset();
  animalCountMock.mockReset();
  campFindManyMock.mockReset();
  mobFindManyMock.mockReset();
  getPrismaForFarmMock.mockReset();
  getFarmModeMock.mockReset();
  getAnimalsInWithdrawalMock.mockReset();

  getFarmModeMock.mockResolvedValue("cattle");
  getAnimalsInWithdrawalMock.mockResolvedValue([]);
  campFindManyMock.mockResolvedValue([{ campId: "camp-1", campName: "Camp 1" }]);
  mobFindManyMock.mockResolvedValue([]);
  // Issue #205 — page.tsx now fires two `animal.count` calls (species total +
  // cross-species Active total) for the header reconciliation line. The
  // existing pagination assertions don't care about the values; any number works.
  animalCountMock.mockResolvedValue(0);

  getPrismaForFarmMock.mockResolvedValue({
    animal: { findMany: animalFindManyMock, count: animalCountMock },
    camp: { findMany: campFindManyMock },
    mob: { findMany: mobFindManyMock },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<AdminAnimalsPage /> — SSR pagination", () => {
  it("asks Prisma for at most 50 animals on first render", async () => {
    animalFindManyMock.mockResolvedValue(fakeAnimals(50));
    const { default: AdminAnimalsPage } = await import(
      "@/app/[farmSlug]/admin/animals/page"
    );
    const element = await AdminAnimalsPage({
      params: Promise.resolve({ farmSlug: "delta-livestock" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(animalFindManyMock).toHaveBeenCalledTimes(1);
    const call = animalFindManyMock.mock.calls[0][0];
    expect(call.take).toBe(50);
  });

  it("renders the first 50 animals and shows a Load more control when a cursor is returned", async () => {
    const rows = fakeAnimals(50);
    animalFindManyMock.mockResolvedValue(rows);
    const { default: AdminAnimalsPage } = await import(
      "@/app/[farmSlug]/admin/animals/page"
    );
    const element = await AdminAnimalsPage({
      params: Promise.resolve({ farmSlug: "delta-livestock" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    // Each row links to the animal detail page, so we can count render rows
    // by counting those links.
    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/delta-livestock/admin/animals/"));
    expect(links.length).toBe(50);

    // Load more control is visible when a nextCursor exists.
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();
  });

  it("fires GET /api/animals?limit=50&cursor=<last-id> when Load more is clicked", async () => {
    const rows = fakeAnimals(50);
    animalFindManyMock.mockResolvedValue(rows);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null, hasMore: false }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock;

    const { default: AdminAnimalsPage } = await import(
      "@/app/[farmSlug]/admin/animals/page"
    );
    const element = await AdminAnimalsPage({
      params: Promise.resolve({ farmSlug: "delta-livestock" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    const btn = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(btn);
    // React effects + microtasks need to settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/animals");
    expect(url).toContain("limit=50");
    expect(url).toContain(`cursor=${rows[rows.length - 1].animalId}`);
  });

  it("does not show Load more when fewer than 50 rows come back", async () => {
    animalFindManyMock.mockResolvedValue(fakeAnimals(23));
    const { default: AdminAnimalsPage } = await import(
      "@/app/[farmSlug]/admin/animals/page"
    );
    const element = await AdminAnimalsPage({
      params: Promise.resolve({ farmSlug: "delta-livestock" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });
});
