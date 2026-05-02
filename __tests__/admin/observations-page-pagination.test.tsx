// @vitest-environment jsdom
/**
 * __tests__/admin/observations-page-pagination.test.tsx
 *
 * Prove that admin/observations caps its SSR animal prefetch at 50 rows.
 * The visible observations timeline (ObservationsLog) is already client-side
 * paginated via /api/observations, so the payload bloat source is the
 * `prismaAnimals` array serialised into the modal's autocomplete props.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

const animalFindManyMock = vi.fn();
const campFindManyMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getFarmCredsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b-boerdery/admin/observations",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
vi.mock("@/lib/farm-prisma", () => ({ getPrismaForFarm: getPrismaForFarmMock }));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/meta-db", () => ({ getFarmCreds: getFarmCredsMock }));
vi.mock("@/components/admin/ClearSectionButton", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/UpgradePrompt", () => ({
  default: () => null,
}));
vi.mock("@/app/[farmSlug]/admin/observations/ObservationsPageClient", () => ({
  default: (props: { animals: unknown[] }) => {
    // Render the hydrated animals as hidden <span> markers so the test can
    // count without mounting the full modal tree.
    const list = props.animals as Array<{ id: string }>;
    return (
      <div>
        {list.map((a) => (
          <span key={a.id} data-testid="observations-animal" />
        ))}
      </div>
    );
  },
}));

function fakeAnimals(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const id = `C${String(i + 1).padStart(4, "0")}`;
    return { animalId: id, currentCamp: "camp-1" };
  });
}

beforeEach(() => {
  animalFindManyMock.mockReset();
  campFindManyMock.mockReset();
  getPrismaForFarmMock.mockReset();
  getFarmModeMock.mockReset();
  getFarmCredsMock.mockReset();

  getFarmModeMock.mockResolvedValue("cattle");
  getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
  campFindManyMock.mockResolvedValue([{ campId: "camp-1", campName: "Camp 1" }]);
  getPrismaForFarmMock.mockResolvedValue({
    animal: { findMany: animalFindManyMock },
    camp: { findMany: campFindManyMock },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<AdminObservationsPage /> — SSR pagination", () => {
  it("passes `take: 50` to prisma.animal.findMany", async () => {
    animalFindManyMock.mockResolvedValue(fakeAnimals(50));
    const { default: AdminObservationsPage } = await import(
      "@/app/[farmSlug]/admin/observations/page"
    );
    await AdminObservationsPage({
      params: Promise.resolve({ farmSlug: "trio-b-boerdery" }),
    });

    expect(animalFindManyMock).toHaveBeenCalledTimes(1);
    const call = animalFindManyMock.mock.calls[0][0];
    expect(call.take).toBe(50);
  });

  it("threads a cursor search-param through to `findMany.cursor`", async () => {
    animalFindManyMock.mockResolvedValue([]);
    const { default: AdminObservationsPage } = await import(
      "@/app/[farmSlug]/admin/observations/page"
    );
    await AdminObservationsPage({
      params: Promise.resolve({ farmSlug: "trio-b-boerdery" }),
      searchParams: Promise.resolve({ cursor: "C0050" }),
    });

    const call = animalFindManyMock.mock.calls[0][0];
    expect(call.cursor).toEqual({ animalId: "C0050" });
    expect(call.skip).toBe(1);
  });
});
