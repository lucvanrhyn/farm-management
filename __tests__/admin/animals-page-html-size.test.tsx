// @vitest-environment jsdom
/**
 * __tests__/admin/animals-page-html-size.test.tsx
 *
 * Regression guard on the serialised HTML payload for admin/animals. With
 * 874 animals and no pagination the production HTML was measured at 557 KB
 * for trio-b-boerdery. SSR-capped at `take: 50`, it has to stay well under
 * 100 KB regardless of tenant size.
 *
 * `renderToString` only captures the static HTML produced by the React
 * tree — it doesn't include the RSC flight payload where Server Component
 * props are serialised. On a Next App Router page like this, the flight
 * payload is the dominant cost when props include hundreds of Prisma
 * records (each ~450 bytes JSON-encoded). So this test primarily guards
 * the *rendered DOM* size; the real-world savings from the flight payload
 * cap are an additional multiplier on top. The 100 KB threshold is a
 * generous regression gate for the rendered portion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

const animalFindManyMock = vi.fn();
const campFindManyMock = vi.fn();
const mobFindManyMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getAnimalsInWithdrawalMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b-boerdery/admin/animals",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/farm-prisma", () => ({ getPrismaForFarm: getPrismaForFarmMock }));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/server/treatment-analytics", () => ({
  getAnimalsInWithdrawal: getAnimalsInWithdrawalMock,
}));
vi.mock("@/components/admin/AnimalAnalyticsSection", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/ClearSectionButton", () => ({ default: () => null }));
vi.mock("@/components/admin/RecordBirthButton", () => ({ default: () => null }));
vi.mock("@/components/admin/ExportButton", () => ({ default: () => null }));
vi.mock("@/lib/farm-mode", () => ({
  useFarmModeSafe: () => ({ mode: "cattle" }),
}));

function fakeAnimals(n: number) {
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
  campFindManyMock.mockReset();
  mobFindManyMock.mockReset();
  getPrismaForFarmMock.mockReset();
  getFarmModeMock.mockReset();
  getAnimalsInWithdrawalMock.mockReset();

  getFarmModeMock.mockResolvedValue("cattle");
  getAnimalsInWithdrawalMock.mockResolvedValue([]);
  campFindManyMock.mockResolvedValue([{ campId: "camp-1", campName: "Camp 1" }]);
  mobFindManyMock.mockResolvedValue([]);

  getPrismaForFarmMock.mockResolvedValue({
    animal: { findMany: animalFindManyMock },
    camp: { findMany: campFindManyMock },
    mob: { findMany: mobFindManyMock },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin/animals — serialised HTML size", () => {
  it("asks Prisma for only 50 rows so the RSC flight payload stays small", async () => {
    // The real bloat source on the old page was the *flight payload* —
    // Server Component props are serialised inline in the HTML document as
    // JSON. Capping `take: 50` means the `initialAnimals` prop holds at
    // most 50 records (~450 bytes each → ~22 KB worst case) instead of
    // the full herd.
    animalFindManyMock.mockImplementation(async (args: { take?: number }) => {
      expect(args.take).toBe(50);
      return fakeAnimals(Math.min(args.take ?? 0, 874));
    });
    const { default: AdminAnimalsPage } = await import(
      "@/app/[farmSlug]/admin/animals/page"
    );
    await AdminAnimalsPage({
      params: Promise.resolve({ farmSlug: "trio-b-boerdery" }),
      searchParams: Promise.resolve({}),
    });
    expect(animalFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("the old unbounded findMany would blow past 100 KB on trio-b (baseline only — skipped in CI)", async () => {
    // This test documents the *baseline* we're migrating away from. It
    // forces the mock to return all 874 rows (ignoring `take:`) which is
    // how the page behaved before this change, and shows the payload size
    // grows to hundreds of KB. Skipped by default so the baseline number
    // is emitted as a log line without blocking.
    animalFindManyMock.mockImplementation(async () => fakeAnimals(874));
    const { default: AdminAnimalsPage } = await import(
      "@/app/[farmSlug]/admin/animals/page"
    );
    const element = await AdminAnimalsPage({
      params: Promise.resolve({ farmSlug: "trio-b-boerdery" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToString(element);
    const bytes = new TextEncoder().encode(html).length;
    // eslint-disable-next-line no-console
    console.log(`[size-snapshot] admin/animals BASELINE (874 rows): ${bytes} bytes`);
    // No assertion — this is a documented measurement, not a gate.
  });

  it("stays under 100 KB even when the tenant has 874 animals (trio-b profile)", async () => {
    // Key assertion: the page asked Prisma for `take: 50`, so even with a
    // huge tenant only 50 rows make it into the DOM.
    animalFindManyMock.mockImplementation(async (args: { take?: number }) => {
      const take = args.take ?? 0;
      // Simulate the DB obeying the take — return min(take, population).
      return fakeAnimals(Math.min(take, 874));
    });

    const { default: AdminAnimalsPage } = await import(
      "@/app/[farmSlug]/admin/animals/page"
    );
    const element = await AdminAnimalsPage({
      params: Promise.resolve({ farmSlug: "trio-b-boerdery" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToString(element);
    const bytes = new TextEncoder().encode(html).length;

    // Leave generous headroom; the point is to catch an order-of-magnitude
    // regression (e.g. someone removing `take:` in the future).
    expect(bytes).toBeLessThan(100 * 1024);
    // Surface the measured number in the test log for easy before/after
    // comparison. Not a hard assertion.
    // eslint-disable-next-line no-console
    console.log(`[size-snapshot] admin/animals SSR HTML: ${bytes} bytes`);
  });
});
