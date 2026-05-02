// @vitest-environment jsdom
/**
 * __tests__/admin/mobs-ssr-bounded.test.tsx
 *
 * Phase I.2 regression guard. The /admin/mobs page used to SSR every active
 * animal for the tenant (874 rows on trio-b, ~120 KB JSON) because
 * MobsManager needed the full roster to power the "add animal to mob"
 * picker. The two concerns are now split:
 *   1. Display of "which animals are in each mob" uses a narrow projection
 *      ({ animalId, mobId, name }) filtered to animals actually assigned to
 *      a mob (mobId != null).
 *   2. The "add animal to mob" picker is client-side and paginates
 *      /api/animals.
 *
 * This test asserts the Prisma call shape on the server page — the narrow
 * select and the mobId-bound where — and guards against regression by
 * measuring the serialised SSR HTML size with a large roster.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

const animalFindManyMock = vi.fn();
const animalGroupByMock = vi.fn();
const campFindManyMock = vi.fn();
const mobFindManyMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b-boerdery/admin/mobs",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
vi.mock("@/lib/farm-prisma", () => ({ getPrismaForFarm: getPrismaForFarmMock }));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));

function fakeMembership(n: number) {
  // Simulate the narrow projection the page should request: only the fields
  // MobsManager renders for "in this mob" rows.
  return Array.from({ length: n }, (_, i) => {
    const id = `C${String(i + 1).padStart(4, "0")}`;
    return {
      animalId: id,
      name: i % 5 === 0 ? `Name-${id}` : null,
      mobId: `mob-${(i % 10) + 1}`,
    };
  });
}

beforeEach(() => {
  animalFindManyMock.mockReset();
  animalGroupByMock.mockReset();
  campFindManyMock.mockReset();
  mobFindManyMock.mockReset();
  getPrismaForFarmMock.mockReset();
  getFarmModeMock.mockReset();

  getFarmModeMock.mockResolvedValue("cattle");
  campFindManyMock.mockResolvedValue([
    { campId: "camp-1", campName: "Camp 1" },
  ]);
  mobFindManyMock.mockResolvedValue([
    { id: "mob-1", name: "Weaners", currentCamp: "camp-1" },
  ]);
  animalGroupByMock.mockResolvedValue([]);

  getPrismaForFarmMock.mockResolvedValue({
    animal: { findMany: animalFindManyMock, groupBy: animalGroupByMock },
    camp: { findMany: campFindManyMock },
    mob: { findMany: mobFindManyMock },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin/mobs — SSR payload is bounded to the membership roster", () => {
  it("requests a narrow select and filters on mobId != null", async () => {
    animalFindManyMock.mockImplementation(
      async (args: { select?: Record<string, boolean>; where?: Record<string, unknown> }) => {
        // Narrow projection: no kitchen-sink fetch.
        expect(args.select).toBeDefined();
        expect(args.select).toMatchObject({
          animalId: true,
          name: true,
          mobId: true,
        });
        // Must NOT pull columns MobsManager doesn't need anymore.
        expect(args.select).not.toHaveProperty("sex");
        expect(args.select).not.toHaveProperty("breed");
        expect(args.select).not.toHaveProperty("dateOfBirth");
        expect(args.select).not.toHaveProperty("currentCamp");
        expect(args.select).not.toHaveProperty("category");
        // Filter to animals currently assigned to a mob — unassigned animals
        // are the picker's concern and arrive via the paginated API.
        expect(args.where).toMatchObject({
          status: "Active",
          species: "cattle",
          mobId: { not: null },
        });
        return [];
      },
    );

    const { default: AdminMobsPage } = await import(
      "@/app/[farmSlug]/admin/mobs/page"
    );
    await AdminMobsPage({
      params: Promise.resolve({ farmSlug: "trio-b-boerdery" }),
    });

    expect(animalFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("SSR HTML stays under 50 KB even with 874 assigned animals", async () => {
    // Even if the whole herd were assigned to a mob (worst case for the
    // membership projection), the narrow select keeps the serialised prop
    // well under the old ~120 KB baseline.
    animalFindManyMock.mockResolvedValue(fakeMembership(874));

    const { default: AdminMobsPage } = await import(
      "@/app/[farmSlug]/admin/mobs/page"
    );
    const element = await AdminMobsPage({
      params: Promise.resolve({ farmSlug: "trio-b-boerdery" }),
    });
    const html = renderToString(element);
    const bytes = new TextEncoder().encode(html).length;

    expect(bytes).toBeLessThan(50 * 1024);
    // eslint-disable-next-line no-console
    console.log(`[size-snapshot] admin/mobs SSR HTML: ${bytes} bytes`);
  });
});
