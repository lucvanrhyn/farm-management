// lib/server/cached.ts
// Cached wrappers for expensive server functions.
// Each wrapper resolves the PrismaClient internally from the farm slug
// so that only serializable arguments + return values cross the cache boundary.

import { unstable_cache } from "next/cache";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getLatestCampConditions, type LiveCampStatus } from "@/lib/server/camp-status";
import { getReproStats, type ReproStats } from "@/lib/server/reproduction-analytics";
import {
  getDashboardAlerts,
  type AlertThresholds,
  type DashboardAlerts,
  type PreFetchedAlertData,
} from "@/lib/server/dashboard-alerts";
import { getDataHealthScore, type DataHealthScore } from "@/lib/server/data-health";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function requirePrisma(farmSlug: string) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) throw new Error(`Farm not found: ${farmSlug}`);
  return prisma;
}

// Map is not JSON-serializable so we convert to/from a plain record.
type LiveCampStatusRecord = Record<string, LiveCampStatus>;

function mapToRecord(map: Map<string, LiveCampStatus>): LiveCampStatusRecord {
  const record: LiveCampStatusRecord = {};
  for (const [k, v] of map) {
    record[k] = v;
  }
  return record;
}

function recordToMap(record: LiveCampStatusRecord): Map<string, LiveCampStatus> {
  return new Map(Object.entries(record));
}

// ── Cached: Camp Conditions (60s) ────────────────────────────────────────────

export async function getCachedCampConditions(
  farmSlug: string,
): Promise<Map<string, LiveCampStatus>> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<LiveCampStatusRecord> => {
      const prisma = await requirePrisma(slug);
      const map = await getLatestCampConditions(prisma);
      return mapToRecord(map);
    },
    ["camp-conditions"],
    { revalidate: 60, tags: ["camp-status", `farm-${farmSlug}`] },
  );
  const record = await fetcher(farmSlug);
  return recordToMap(record);
}

// ── Cached: Repro Stats (60s) ────────────────────────────────────────────────

export async function getCachedReproStats(
  farmSlug: string,
): Promise<ReproStats> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<ReproStats> => {
      const prisma = await requirePrisma(slug);
      return getReproStats(prisma);
    },
    ["repro-stats"],
    { revalidate: 60, tags: ["farm-data", `farm-${farmSlug}`] },
  );
  return fetcher(farmSlug);
}

// ── Cached: Dashboard Alerts (30s) ───────────────────────────────────────────

export async function getCachedDashboardAlerts(
  farmSlug: string,
  thresholds: AlertThresholds,
  preFetched?: PreFetchedAlertData,
): Promise<DashboardAlerts> {
  // When pre-fetched data is provided we skip caching (data is already fresh)
  if (preFetched && (preFetched.reproStats || preFetched.campConditions)) {
    const prisma = await requirePrisma(farmSlug);
    return getDashboardAlerts(prisma, farmSlug, thresholds, preFetched);
  }

  const fetcher = unstable_cache(
    async (slug: string, t: AlertThresholds): Promise<DashboardAlerts> => {
      const prisma = await requirePrisma(slug);
      return getDashboardAlerts(prisma, slug, t);
    },
    ["dashboard-alerts"],
    { revalidate: 30, tags: ["dashboard", `farm-${farmSlug}`] },
  );
  return fetcher(farmSlug, thresholds);
}

// ── Cached: Data Health (60s) ────────────────────────────────────────────────

export async function getCachedDataHealth(
  farmSlug: string,
): Promise<DataHealthScore> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<DataHealthScore> => {
      const prisma = await requirePrisma(slug);
      return getDataHealthScore(prisma);
    },
    ["data-health"],
    { revalidate: 60, tags: ["farm-data", `farm-${farmSlug}`] },
  );
  return fetcher(farmSlug);
}

// ── Cached: Dashboard Overview (30s) — single cache entry for entire admin page ──

import {
  countHealthIssuesSince,
  countInspectedToday,
  getRecentHealthObservations,
  getLowGrazingCampCount,
  type HealthObservation,
} from "@/lib/server/camp-status";
import { getWithdrawalCount } from "@/lib/server/treatment-analytics";

export interface DashboardOverview {
  totalAnimals: number;
  totalCamps: number;
  reproStats: ReproStats;
  liveConditions: LiveCampStatusRecord;
  healthIssuesThisWeek: number;
  inspectedToday: number;
  recentHealth: HealthObservation[];
  lowGrazingCount: number;
  deathsToday: number;
  birthsToday: number;
  withdrawalCount: number;
  mtdTransactions: { type: string; amount: number }[];
  dataHealth: DataHealthScore;
  dashboardAlerts: DashboardAlerts;
}

export async function getCachedDashboardOverview(
  farmSlug: string,
): Promise<DashboardOverview> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<DashboardOverview> => {
      const prisma = await requirePrisma(slug);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const currentMonth = new Date().toISOString().slice(0, 7);

      const [
        totalAnimals,
        totalCamps,
        settingsRow,
        reproStats,
        campConditions,
        healthIssuesThisWeek,
        inspectedToday,
        recentHealth,
        lowGrazingCount,
        deathsToday,
        birthsToday,
        withdrawalCount,
        mtdTransactions,
        dataHealth,
      ] = await Promise.all([
        prisma.animal.count({ where: { status: "Active" } }),
        prisma.camp.count(),
        prisma.farmSettings.findFirst(),
        getReproStats(prisma),
        getLatestCampConditions(prisma),
        countHealthIssuesSince(prisma, sevenDaysAgo),
        countInspectedToday(prisma),
        getRecentHealthObservations(prisma, 8),
        getLowGrazingCampCount(prisma),
        prisma.observation.count({ where: { type: "death", observedAt: { gte: todayStart } } }),
        prisma.observation.count({ where: { type: "calving", observedAt: { gte: todayStart } } }),
        getWithdrawalCount(prisma),
        prisma.transaction.findMany({
          where: { date: { startsWith: currentMonth } },
          select: { type: true, amount: true },
        }),
        getDataHealthScore(prisma),
      ]);

      const settings = settingsRow ?? {
        adgPoorDoerThreshold: 0.7,
        calvingAlertDays: 14,
        daysOpenLimit: 365,
        campGrazingWarningDays: 7,
        alertThresholdHours: 48,
      };

      const dashboardAlerts = await getDashboardAlerts(prisma, slug, {
        adgPoorDoerThreshold: settings.adgPoorDoerThreshold,
        calvingAlertDays: settings.calvingAlertDays,
        daysOpenLimit: settings.daysOpenLimit,
        campGrazingWarningDays: settings.campGrazingWarningDays,
        staleCampInspectionHours: settings.alertThresholdHours,
      }, { reproStats, campConditions });

      return {
        totalAnimals,
        totalCamps,
        reproStats,
        liveConditions: mapToRecord(campConditions),
        healthIssuesThisWeek,
        inspectedToday,
        recentHealth,
        lowGrazingCount,
        deathsToday,
        birthsToday,
        withdrawalCount,
        mtdTransactions: mtdTransactions.map((t) => ({ type: t.type, amount: t.amount })),
        dataHealth,
        dashboardAlerts,
      };
    },
    ["dashboard-overview"],
    { revalidate: 30, tags: ["dashboard", `farm-${farmSlug}`] },
  );
  return fetcher(farmSlug);
}

// ── Cached: Farm Settings (5 min) ────────────────────────────────────────────

export interface FarmSettingsData {
  adgPoorDoerThreshold: number;
  calvingAlertDays: number;
  daysOpenLimit: number;
  campGrazingWarningDays: number;
  alertThresholdHours: number;
  farmName: string;
  breed: string;
}

const SETTINGS_DEFAULTS: FarmSettingsData = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  alertThresholdHours: 48,
  farmName: "My Farm",
  breed: "Mixed",
};

export async function getCachedFarmSettings(
  farmSlug: string,
): Promise<FarmSettingsData> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<FarmSettingsData> => {
      const prisma = await requirePrisma(slug);
      const row = await prisma.farmSettings.findFirst();
      if (!row) return SETTINGS_DEFAULTS;
      return {
        adgPoorDoerThreshold: row.adgPoorDoerThreshold,
        calvingAlertDays: row.calvingAlertDays,
        daysOpenLimit: row.daysOpenLimit,
        campGrazingWarningDays: row.campGrazingWarningDays,
        alertThresholdHours: row.alertThresholdHours,
        farmName: row.farmName,
        breed: row.breed,
      };
    },
    ["farm-settings"],
    { revalidate: 300, tags: ["farm-settings", `farm-${farmSlug}`] },
  );
  return fetcher(farmSlug);
}

// ── Cached: Camp List with animal counts (30s) ────────────────────────────────

export interface CachedCamp {
  camp_id: string;
  camp_name: string;
  size_hectares: number | null;
  water_source: string | null;
  geojson: string | null;
  color: string | null;
  animal_count: number;
}

export async function getCachedCampList(
  farmSlug: string,
  species?: string,
): Promise<CachedCamp[]> {
  const fetcher = unstable_cache(
    async (slug: string, sp: string): Promise<CachedCamp[]> => {
      const prisma = await requirePrisma(slug);
      const [camps, animalGroups] = await Promise.all([
        prisma.camp.findMany({ orderBy: { campName: "asc" } }),
        prisma.animal.groupBy({
          by: ["currentCamp"],
          where: {
            status: "Active",
            ...(sp ? { species: sp } : {}),
          },
          _count: { _all: true },
        }),
      ]);
      const countByCamp: Record<string, number> = {};
      for (const g of animalGroups) {
        countByCamp[g.currentCamp] = g._count._all;
      }
      return camps.map((camp) => ({
        camp_id: camp.campId,
        camp_name: camp.campName,
        size_hectares: camp.sizeHectares,
        water_source: camp.waterSource,
        geojson: camp.geojson,
        color: camp.color ?? null,
        animal_count: countByCamp[camp.campId] ?? 0,
      }));
    },
    ["camp-list"],
    { revalidate: 30, tags: ["camps", `farm-${farmSlug}`] },
  );
  return fetcher(farmSlug, species ?? "");
}

// ── Cached: Farm Summary (30s) — animal + camp counts for /api/farm ──────────

export interface FarmSummary {
  farmName: string;
  breed: string;
  heroImageUrl: string;
  animalCount: number;
  campCount: number;
}

export async function getCachedFarmSummary(
  farmSlug: string,
): Promise<FarmSummary> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<FarmSummary> => {
      const prisma = await requirePrisma(slug);
      const [settings, animalCount, campCount] = await Promise.all([
        prisma.farmSettings.findFirst(),
        prisma.animal.count({ where: { status: "Active" } }),
        prisma.camp.count(),
      ]);
      return {
        farmName: settings?.farmName ?? "My Farm",
        breed: settings?.breed ?? "Mixed",
        heroImageUrl: settings?.heroImageUrl ?? "/farm-hero.jpg",
        animalCount,
        campCount,
      };
    },
    ["farm-summary"],
    { revalidate: 30, tags: ["farm-data", `farm-${farmSlug}`] },
  );
  return fetcher(farmSlug);
}
