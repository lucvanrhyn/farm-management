// @vitest-environment jsdom
/**
 * __tests__/admin/finansies-page-pagination.test.tsx
 *
 * Prove that admin/finansies (South African spelling of "finance") caps its
 * transactions SSR fetch at 50 rows and threads a `?cursor=<id>` search-param
 * through to `prisma.transaction.findMany`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

const txFindManyMock = vi.fn();
const txCountMock = vi.fn();
const categoryFindManyMock = vi.fn();
const categoryCountMock = vi.fn();
const categoryCreateManyMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmCredsMock = vi.fn();
const getServerSessionMock = vi.fn();

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/delta-livestock/admin/finansies",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/farm-prisma", () => ({ getPrismaForFarm: getPrismaForFarmMock }));
vi.mock("@/lib/meta-db", () => ({ getFarmCreds: getFarmCredsMock }));
vi.mock("@/lib/constants/default-categories", () => ({ DEFAULT_CATEGORIES: [] }));

// Stub every render-heavy child so the test stays focused on the Prisma
// call-site.
vi.mock("@/components/admin/FinansiesClient", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/FinancialAnalyticsPanelLazy", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/FinancialChartsSection", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/FinancialKPISection", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/BudgetVsActualSection", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/CostOfGainSection", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/ClearSectionButton", () => ({ default: () => null }));
vi.mock("@/components/admin/ExportButton", () => ({ default: () => null }));
vi.mock("@/components/admin/DateRangePicker", () => ({ default: () => null }));
vi.mock("@/components/admin/UpgradePrompt", () => ({ default: () => null }));

function fakeTransactions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `tx-${String(i + 1).padStart(4, "0")}`,
    type: "income",
    category: "Animal Sales",
    amount: 100 + i,
    date: "2026-01-01",
    description: "test",
    animalId: null,
  }));
}

beforeEach(() => {
  txFindManyMock.mockReset();
  txCountMock.mockReset();
  categoryFindManyMock.mockReset();
  categoryCountMock.mockReset();
  categoryCreateManyMock.mockReset();
  getPrismaForFarmMock.mockReset();
  getFarmCredsMock.mockReset();
  getServerSessionMock.mockReset();

  getServerSessionMock.mockResolvedValue({ user: { email: "a@b.c" } });
  getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
  categoryCountMock.mockResolvedValue(10);
  categoryFindManyMock.mockResolvedValue([]);

  getPrismaForFarmMock.mockResolvedValue({
    transaction: { findMany: txFindManyMock },
    transactionCategory: {
      count: categoryCountMock,
      findMany: categoryFindManyMock,
      createMany: categoryCreateManyMock,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<FinansiesPage /> — SSR pagination", () => {
  it("passes `take: 50` to prisma.transaction.findMany", async () => {
    txFindManyMock.mockResolvedValue(fakeTransactions(50));
    const { default: FinansiesPage } = await import(
      "@/app/[farmSlug]/admin/finansies/page"
    );
    await FinansiesPage({
      params: Promise.resolve({ farmSlug: "delta-livestock" }),
      searchParams: Promise.resolve({}),
    });

    expect(txFindManyMock).toHaveBeenCalledTimes(1);
    const call = txFindManyMock.mock.calls[0][0];
    expect(call.take).toBe(50);
    // Finance list is ordered by `date desc`, then `id desc` as a tie-break
    // for a stable cursor.
    expect(call.orderBy).toBeDefined();
  });

  it("threads a cursor search-param through to `findMany.cursor`", async () => {
    txFindManyMock.mockResolvedValue([]);
    const { default: FinansiesPage } = await import(
      "@/app/[farmSlug]/admin/finansies/page"
    );
    await FinansiesPage({
      params: Promise.resolve({ farmSlug: "delta-livestock" }),
      searchParams: Promise.resolve({ cursor: "tx-0050" }),
    });

    const call = txFindManyMock.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: "tx-0050" });
    expect(call.skip).toBe(1);
  });
});
