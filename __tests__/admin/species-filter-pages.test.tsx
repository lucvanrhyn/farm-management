// @vitest-environment jsdom
/**
 * __tests__/admin/species-filter-pages.test.tsx
 *
 * Wave 3 / Phase F regression lock: every species-scoped admin/dashboard
 * server page must pass `species: <mode>` (or a literal "cattle"/"sheep")
 * to every `prisma.animal.{findMany,count,groupBy}` call it makes.
 *
 * Why: without `species: mode` in the where clause, a sheep-mode page
 * silently lists every cattle in the herd. The species column has a
 * supporting index (idx_animal_species_status) so adding the filter is
 * also a perf positive — see the prisma/schema.prisma index definitions.
 *
 * Established pattern (don't break):
 *   const mode = await getFarmMode(farmSlug);
 *   prisma.animal.findMany({ where: { ..., species: mode } });
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

const animalFindManyMock = vi.fn();
const animalGroupByMock = vi.fn();
const animalCountMock = vi.fn();
const animalFindUniqueMock = vi.fn();
const observationFindManyMock = vi.fn();
const observationFindFirstMock = vi.fn();
const observationCountMock = vi.fn();
const campFindManyMock = vi.fn();
const campFindFirstMock = vi.fn();
const campFindUniqueMock = vi.fn();
const campCoverFindFirstMock = vi.fn();
const campCoverFindManyMock = vi.fn();
const mobFindManyMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getFarmCredsMock = vi.fn();
const getLatestCampConditionsMock = vi.fn();
const getAnimalsInWithdrawalMock = vi.fn();
const getRotationStatusByCampMock = vi.fn();
const getAnimalWeightDataMock = vi.fn();
const getCostPerAnimalMock = vi.fn();
const calcPastureGrowthRateMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b/admin",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/farm-prisma", () => ({ getPrismaForFarm: getPrismaForFarmMock }));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/meta-db", () => ({ getFarmCreds: getFarmCredsMock }));
vi.mock("@/lib/server/camp-status", () => ({
  getLatestCampConditions: getLatestCampConditionsMock,
}));
vi.mock("@/lib/server/treatment-analytics", () => ({
  getAnimalsInWithdrawal: getAnimalsInWithdrawalMock,
}));
vi.mock("@/lib/server/rotation-engine", () => ({
  getRotationStatusByCamp: getRotationStatusByCampMock,
}));
vi.mock("@/lib/server/analytics", () => ({
  calcPastureGrowthRate: calcPastureGrowthRateMock,
}));
vi.mock("@/lib/server/weight-analytics", () => ({
  getAnimalWeightData: getAnimalWeightDataMock,
}));
vi.mock("@/lib/server/financial-analytics", () => ({
  getCostPerAnimal: getCostPerAnimalMock,
  // Other exports are stubbed when imported elsewhere; this page only
  // needs getCostPerAnimal at module scope.
  getFinancialAnalytics: vi.fn(),
  getProfitabilityByCategory: vi.fn(),
  getFinancialKPIs: vi.fn(),
  getBudgetVsActual: vi.fn(),
  getCostPerCamp: vi.fn(),
  getCogByCamp: vi.fn(),
  getCogByAnimal: vi.fn(),
  getCogSummary: vi.fn(),
}));

// Heavy client components — we only care about the prisma calls.
vi.mock("@/components/admin/MobsManager", () => ({ default: () => null }));
vi.mock("@/components/admin/AnimalsTable", () => ({ default: () => null }));
vi.mock("@/components/admin/AnimalAnalyticsSection", () => ({ default: () => null }));
vi.mock("@/components/admin/RecordBirthButton", () => ({ default: () => null }));
vi.mock("@/components/admin/ExportButton", () => ({ default: () => null }));
vi.mock("@/components/admin/ClearSectionButton", () => ({ default: () => null }));
vi.mock("@/components/admin/UpgradePrompt", () => ({ default: () => null }));
vi.mock("@/components/admin/MobKPICard", () => ({ default: () => null }));
vi.mock("@/components/admin/PastureIntelligenceCard", () => ({ default: () => null }));
vi.mock("@/components/admin/CampCoverForm", () => ({ default: () => null }));
vi.mock("@/components/admin/rotation/CampRotationHistoryPanel", () => ({ default: () => null }));
vi.mock("@/components/admin/AnimalActions", () => ({ default: () => null }));
vi.mock("@/components/admin/AnimalInvestment", () => ({ default: () => null }));
vi.mock("@/components/admin/CostOfGainCard", () => ({ default: () => null }));
vi.mock("@/components/admin/charts/WeightTrendChart", () => ({ default: () => null }));
vi.mock("@/components/admin/finansies/AnimalActions", () => ({ default: () => null }));
vi.mock("@/components/dashboard/StatusIndicator", () => ({ default: () => null }));

function buildPrismaMock() {
  return {
    animal: {
      findMany: animalFindManyMock,
      groupBy: animalGroupByMock,
      count: animalCountMock,
      findUnique: animalFindUniqueMock,
    },
    camp: {
      findMany: campFindManyMock,
      findFirst: campFindFirstMock,
      findUnique: campFindUniqueMock,
    },
    campCoverReading: {
      findFirst: campCoverFindFirstMock,
      findMany: campCoverFindManyMock,
    },
    observation: {
      findMany: observationFindManyMock,
      findFirst: observationFindFirstMock,
      count: observationCountMock,
    },
    mob: {
      findMany: mobFindManyMock,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getFarmModeMock.mockResolvedValue("cattle");
  getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
  getPrismaForFarmMock.mockResolvedValue(buildPrismaMock());
  getLatestCampConditionsMock.mockResolvedValue(new Map());
  getAnimalsInWithdrawalMock.mockResolvedValue([]);
  getRotationStatusByCampMock.mockResolvedValue({ camps: [] });
  getAnimalWeightDataMock.mockResolvedValue({ records: [], adg: null });
  getCostPerAnimalMock.mockResolvedValue({ totalCost: 0, breakdown: [] });
  calcPastureGrowthRateMock.mockResolvedValue({
    currentKgDmPerHa: null,
    growthRateKgPerDay: null,
    projectedRecoveryDays: null,
  });

  // Default sensible empty results — individual tests override as needed.
  animalFindManyMock.mockResolvedValue([]);
  animalGroupByMock.mockResolvedValue([]);
  animalCountMock.mockResolvedValue(0);
  animalFindUniqueMock.mockResolvedValue(null);
  campFindManyMock.mockResolvedValue([]);
  campFindFirstMock.mockResolvedValue(null);
  campFindUniqueMock.mockResolvedValue(null);
  campCoverFindFirstMock.mockResolvedValue(null);
  campCoverFindManyMock.mockResolvedValue([]);
  observationFindManyMock.mockResolvedValue([]);
  observationFindFirstMock.mockResolvedValue(null);
  observationCountMock.mockResolvedValue(0);
  mobFindManyMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Tiny helper: did *every* invocation of the given mock receive a where
 * clause that scopes by `species`?
 */
function everyCallScopesBySpecies(
  mock: ReturnType<typeof vi.fn>,
  expected: string,
): boolean {
  if (mock.mock.calls.length === 0) return false;
  return mock.mock.calls.every((call) => {
    const arg = call[0];
    if (!arg || typeof arg !== "object") return false;
    const where = (arg as { where?: { species?: unknown } }).where;
    return where !== undefined && where.species === expected;
  });
}

describe("species-filter regression lock — admin pages bind species: mode", () => {
  it("admin/animals page filters animal.findMany by species: mode", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    const { default: AdminAnimalsPage } = await import(
      "@/app/[farmSlug]/admin/animals/page"
    );
    await AdminAnimalsPage({
      params: Promise.resolve({ farmSlug: "trio-b" }),
      searchParams: Promise.resolve({}),
    });
    expect(everyCallScopesBySpecies(animalFindManyMock, "sheep")).toBe(true);
  });

  it("admin/observations page filters animal.findMany by species: mode", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    const { default: AdminObservationsPage } = await import(
      "@/app/[farmSlug]/admin/observations/page"
    );
    await AdminObservationsPage({
      params: Promise.resolve({ farmSlug: "trio-b" }),
    });
    expect(everyCallScopesBySpecies(animalFindManyMock, "sheep")).toBe(true);
  });

  it("admin/mobs page filters animal.findMany AND animal.groupBy by species: mode", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    const { default: AdminMobsPage } = await import(
      "@/app/[farmSlug]/admin/mobs/page"
    );
    await AdminMobsPage({ params: Promise.resolve({ farmSlug: "trio-b" }) });
    expect(everyCallScopesBySpecies(animalFindManyMock, "sheep")).toBe(true);
    expect(everyCallScopesBySpecies(animalGroupByMock, "sheep")).toBe(true);
  });

  it("admin/camps/[campId] page filters animal.findMany by species: mode", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    campFindUniqueMock.mockResolvedValue({
      campId: "camp-1",
      campName: "Camp 1",
      sizeHectares: 10,
      waterSource: "Borehole",
    });
    const { default: CampDetailPage } = await import(
      "@/app/[farmSlug]/admin/camps/[campId]/page"
    );
    await CampDetailPage({
      params: Promise.resolve({ farmSlug: "trio-b", campId: "camp-1" }),
    });
    expect(everyCallScopesBySpecies(animalFindManyMock, "sheep")).toBe(true);
  });

  it("dashboard/camp/[campId] page filters animal.findMany by species: mode", async () => {
    getFarmModeMock.mockResolvedValue("sheep");
    campFindFirstMock.mockResolvedValue({
      campId: "camp-1",
      campName: "Camp 1",
      sizeHectares: 10,
      waterSource: "Borehole",
    });
    const { default: DashboardCampPage } = await import(
      "@/app/[farmSlug]/dashboard/camp/[campId]/page"
    );
    await DashboardCampPage({
      params: Promise.resolve({ farmSlug: "trio-b", campId: "camp-1" }),
    });
    expect(everyCallScopesBySpecies(animalFindManyMock, "sheep")).toBe(true);
  });

  it("admin/animals/[id] page (Bull progeny) filters animal.findMany by the parent's species", async () => {
    animalFindUniqueMock.mockResolvedValue({
      id: "internal-1",
      animalId: "B042",
      species: "cattle",
      category: "Bull",
      currentCamp: "camp-1",
      status: "Active",
      sex: "Male",
      breed: "Brangus",
      name: null,
      dateOfBirth: null,
      dateAdded: "2024-01-01",
      motherId: null,
      fatherId: null,
      mobId: null,
      registrationNumber: null,
      deceasedAt: null,
      createdAt: new Date(),
      speciesData: null,
      sireNote: null,
      damNote: null,
      importJobId: null,
    });
    const { default: AnimalDetailPage } = await import(
      "@/app/[farmSlug]/admin/animals/[id]/page"
    );
    await AnimalDetailPage({
      params: Promise.resolve({ farmSlug: "trio-b", id: "B042" }),
      searchParams: Promise.resolve({}),
    });
    // findMany only fires for Bulls (progeny lookup) — assert species filter
    // matches the parent animal's species.
    expect(everyCallScopesBySpecies(animalFindManyMock, "cattle")).toBe(true);
  });
});

describe("species-filter regression lock — admin pages also work in cattle mode", () => {
  it("admin/animals page in cattle mode uses species: cattle", async () => {
    getFarmModeMock.mockResolvedValue("cattle");
    const { default: AdminAnimalsPage } = await import(
      "@/app/[farmSlug]/admin/animals/page"
    );
    await AdminAnimalsPage({
      params: Promise.resolve({ farmSlug: "trio-b" }),
      searchParams: Promise.resolve({}),
    });
    expect(everyCallScopesBySpecies(animalFindManyMock, "cattle")).toBe(true);
  });
});
