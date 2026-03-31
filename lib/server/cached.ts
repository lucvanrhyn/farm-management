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
