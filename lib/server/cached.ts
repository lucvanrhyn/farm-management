// lib/server/cached.ts
// Cached wrappers for expensive server functions.
// Each wrapper resolves the PrismaClient internally from the farm slug
// so that only serializable arguments + return values cross the cache boundary.
//
// Tags follow the taxonomy in lib/server/cache-tags.ts.
// Mutations must call the corresponding revalidate*Write() helper in
// lib/server/revalidate.ts after every successful DB write.

import { unstable_cache } from "next/cache";
import { withFarmPrisma } from "@/lib/farm-prisma";
import { farmTag, notificationTag } from "@/lib/server/cache-tags";
import { hasMultipleActiveSpecies } from "@/lib/server/has-multiple-species";
import { getLatestCampConditions, type LiveCampStatus } from "@/lib/server/camp-status";
import { getOverviewForUserFarms, type FarmOverview } from "@/lib/server/multi-farm-overview";
import type { SessionFarm } from "@/types/next-auth";
import { getReproStats, type ReproStats } from "@/lib/server/reproduction-analytics";
import {
  getDashboardAlerts,
  type AlertThresholds,
  type DashboardAlerts,
  type PreFetchedAlertData,
} from "@/lib/server/dashboard-alerts";
import { getDataHealthScore, type DataHealthScore } from "@/lib/server/data-health";
import {
  countHealthIssuesSince,
  countInspectedToday,
  getRecentHealthObservations,
  getLowGrazingCampCount,
  type HealthObservation,
} from "@/lib/server/camp-status";
import { getWithdrawalCount } from "@/lib/server/treatment-analytics";
import { getCensusPopulationByCamp } from "@/lib/species/game/analytics";
import { getRotationStatusByCamp, type CampRotationStatus } from "@/lib/server/rotation-engine";
import { getLatestByCamp } from "@/lib/server/veld-score";
import { getLatestCoverByCamp } from "@/lib/server/feed-on-offer";
import { scoped } from "@/lib/server/species-scoped-prisma";
import type { SpeciesId } from "@/lib/species/types";
import type { Camp } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

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
      return withFarmPrisma(slug, async (prisma) => {
        const map = await getLatestCampConditions(prisma);
        return mapToRecord(map);
      });
    },
    ["camp-conditions"],
    { revalidate: 60, tags: [farmTag(farmSlug, "camps")] },
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
      return withFarmPrisma(slug, (prisma) => getReproStats(prisma));
    },
    ["repro-stats"],
    { revalidate: 60, tags: [farmTag(farmSlug, "animals")] },
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
    return withFarmPrisma(farmSlug, (prisma) =>
      getDashboardAlerts(prisma, farmSlug, thresholds, preFetched),
    );
  }

  const fetcher = unstable_cache(
    async (slug: string, t: AlertThresholds): Promise<DashboardAlerts> => {
      return withFarmPrisma(slug, (prisma) =>
        getDashboardAlerts(prisma, slug, t),
      );
    },
    ["dashboard-alerts"],
    { revalidate: 30, tags: [farmTag(farmSlug, "dashboard"), farmTag(farmSlug, "alerts")] },
  );
  return fetcher(farmSlug, thresholds);
}

// ── Cached: Data Health (60s) ────────────────────────────────────────────────

export async function getCachedDataHealth(
  farmSlug: string,
): Promise<DataHealthScore> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<DataHealthScore> => {
      return withFarmPrisma(slug, (prisma) => getDataHealthScore(prisma));
    },
    ["data-health"],
    { revalidate: 60, tags: [farmTag(farmSlug, "dashboard")] },
  );
  return fetcher(farmSlug);
}

// ── Cached: Dashboard Overview (30s) ─────────────────────────────────────────
// Admin dashboard health/stats widget — not the main /dashboard page data.

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
  mode: SpeciesId,
): Promise<DashboardOverview> {
  const fetcher = unstable_cache(
    async (slug: string, currentMode: SpeciesId): Promise<DashboardOverview> => {
      return withFarmPrisma(slug, async (prisma) => {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const currentMonth = new Date().toISOString().slice(0, 7);

        // Issue #225: route per-species reads through the species-scoped
        // facade so `{ species: currentMode }` is injected by construction
        // (PRD #222). `scoped()` is a no-cost in-memory wrapper — same
        // underlying Prisma client; the facade just merges the species
        // predicate into the where clause of each delegate call.
        const speciesPrisma = scoped(prisma, currentMode);

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
          // Active head for the current species (issue #225). The facade's
          // count() injects `{ species: mode }` — status stays caller-controlled
          // per the facade contract (species-scoped-prisma.ts JSDoc).
          speciesPrisma.animal.count({ where: { status: "Active" } }),
          // audit-allow-species-where: camp total is the same on every per-species view; not species-scoped because every camp serves some species at some point.
          prisma.camp.count(),
          prisma.farmSettings.findFirst(),
          getReproStats(prisma, { species: currentMode }),
          getLatestCampConditions(prisma),
          countHealthIssuesSince(prisma, sevenDaysAgo, currentMode),
          countInspectedToday(prisma, currentMode),
          getRecentHealthObservations(prisma, 8, currentMode),
          // cross-species by design: low-grazing math is LSU across all species (camp can host any species).
          getLowGrazingCampCount(prisma),
          // Per-species death/calving tile counts: route through facade so
          // observation rows are filtered to the active species.
          speciesPrisma.observation.count({ where: { type: "death", observedAt: { gte: todayStart } } }),
          speciesPrisma.observation.count({ where: { type: "calving", observedAt: { gte: todayStart } } }),
          getWithdrawalCount(prisma),
          prisma.transaction.findMany({
            where: { date: { startsWith: currentMonth } },
            select: { type: true, amount: true },
          }),
          // cross-species by design: data-health is a farm-wide hygiene score.
          getDataHealthScore(prisma),
        ]);

        const settings = settingsRow ?? {
          adgPoorDoerThreshold: 0.7,
          calvingAlertDays: 14,
          daysOpenLimit: 365,
          campGrazingWarningDays: 7,
          alertThresholdHours: 48,
        };

        const dashboardAlerts = await getDashboardAlerts(
          prisma,
          slug,
          {
            adgPoorDoerThreshold: settings.adgPoorDoerThreshold,
            calvingAlertDays: settings.calvingAlertDays,
            daysOpenLimit: settings.daysOpenLimit,
            campGrazingWarningDays: settings.campGrazingWarningDays,
            staleCampInspectionHours: settings.alertThresholdHours,
          },
          { reproStats, campConditions },
          currentMode,
        );

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
      });
    },
    // Issue #225: `mode` is part of the cache key so cattle and sheep
    // dashboards never share an entry. unstable_cache treats every fn arg as
    // part of the key, but we also include it in keyParts as a documentation
    // signal — same pattern as `multi-farm-overview` keying off userId.
    ["dashboard-overview"],
    { revalidate: 30, tags: [farmTag(farmSlug, "dashboard")] },
  );
  return fetcher(farmSlug, mode);
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
  latitude: number | null;
  longitude: number | null;
}

const SETTINGS_DEFAULTS: FarmSettingsData = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  alertThresholdHours: 48,
  farmName: "My Farm",
  breed: "Mixed",
  latitude: null,
  longitude: null,
};

export async function getCachedFarmSettings(
  farmSlug: string,
): Promise<FarmSettingsData> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<FarmSettingsData> => {
      return withFarmPrisma(slug, async (prisma) => {
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
          latitude: row.latitude ?? null,
          longitude: row.longitude ?? null,
        };
      });
    },
    ["farm-settings"],
    { revalidate: 300, tags: [farmTag(farmSlug, "settings")] },
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
      return withFarmPrisma(slug, async (prisma) => {
        const [camps, animalGroups] = await Promise.all([
          prisma.camp.findMany({ orderBy: { campName: "asc" } }),
          // cross-species by design when `sp` is empty: callers opt in to
          // species filter via the `species` parameter on getCachedCampList.
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
      });
    },
    ["camp-list"],
    { revalidate: 30, tags: [farmTag(farmSlug, "camps")] },
  );
  return fetcher(farmSlug, species ?? "");
}

/**
 * Logger-specific camp list alias — exposes the same cached data as
 * getCachedCampList (all species) under a dedicated name for the logger path.
 * Tags: farm-<slug>-camps (same invalidation as any camp write).
 */
export const getCachedLoggerCampList = (farmSlug: string) =>
  getCachedCampList(farmSlug);

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
      return withFarmPrisma(slug, async (prisma) => {
        const [settings, animalCount, campCount] = await Promise.all([
          prisma.farmSettings.findFirst(),
          // cross-species by design: /api/farm header counts whole farm.
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
      });
    },
    ["farm-summary"],
    {
      revalidate: 30,
      tags: [
        farmTag(farmSlug, "settings"),
        farmTag(farmSlug, "animals"),
        farmTag(farmSlug, "camps"),
      ],
    },
  );
  return fetcher(farmSlug);
}

// ── Cached: Has Multiple Active Species (5 min) ──────────────────────────────
// Issue #235 — drives the ModeSwitcher "+ Add species" upsell pill.
// Mirrors the 300s revalidate of FarmSpeciesSettings since the underlying
// signal (animal-row species distribution) changes at human pace and the
// upsell-pill cost of staleness is cosmetic.
// Tagged on `animals` so any animal create/update/delete on the tenant
// invalidates the cached boolean alongside per-species counts.

export async function getCachedHasMultipleActiveSpecies(
  farmSlug: string,
): Promise<boolean> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<boolean> => hasMultipleActiveSpecies(slug),
    ["has-multiple-active-species"],
    { revalidate: 300, tags: [farmTag(farmSlug, "animals")] },
  );
  return fetcher(farmSlug);
}

// ── Cached: Farm Species Settings (5 min) ─────────────────────────────────────
// Used by [farmSlug]/layout.tsx to populate FarmModeProvider.
// Species list changes rarely — 300s revalidate is appropriate.

export interface FarmSpeciesSettingsData {
  enabledSpecies: string[];
}

export async function getCachedFarmSpeciesSettings(
  farmSlug: string,
): Promise<FarmSpeciesSettingsData> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<FarmSpeciesSettingsData> => {
      return withFarmPrisma(slug, async (prisma) => {
        const settings = await prisma.farmSpeciesSettings.findMany();
        const enabled = settings
          .filter((s) => s.enabled)
          .map((s) => s.species);
        if (!enabled.includes("cattle")) enabled.unshift("cattle");
        return { enabledSpecies: enabled };
      });
    },
    ["farm-species-settings"],
    { revalidate: 300, tags: [farmTag(farmSlug, "settings")] },
  );
  return fetcher(farmSlug);
}

// ── Cached: Multi-farm overview for /farms page (60s) ────────────────────────
// Eliminates the N×3 Turso fan-out on the /farms page.
// Tagged with animals+camps+observations for each farm in the user's list —
// any mutation to any of those scopes clears the entry.

export async function getCachedMultiFarmOverview(
  userId: string,
  farms: SessionFarm[],
): Promise<FarmOverview[]> {
  const slugs = farms.slice(0, 8).map((f) => f.slug);

  const fetcher = unstable_cache(
    async (uid: string, farmSlugs: string[], farmsData: SessionFarm[]): Promise<FarmOverview[]> => {
      void uid;
      void farmSlugs;
      return getOverviewForUserFarms(farmsData);
    },
    ["multi-farm-overview", userId],
    {
      revalidate: 60,
      tags: slugs.flatMap((slug) => [
        farmTag(slug, "animals"),
        farmTag(slug, "camps"),
        farmTag(slug, "observations"),
      ]),
    },
  );

  return fetcher(userId, slugs, farms.slice(0, 8));
}

// ── Cached: Dashboard Page Data (30s) ─────────────────────────────────────────
// Packages all 8 queries that [farmSlug]/dashboard/page.tsx runs on every
// request. The result is fully serializable — Maps are converted to Records
// and the DashboardClient-ready shape is returned directly.
//
// Tags: farm-<slug>-animals (species counts), farm-<slug>-camps (camp list),
//       farm-<slug>-observations (veld/cover/census/rotation).
// Any mutation to animals, camps, or observations will clear this entry.

export interface DashboardData {
  totalAll: number;
  totalBySpecies: Record<string, number>;
  campAnimalCounts: Record<string, number>;
  campCountsBySpecies: Record<string, Record<string, number>>;
  camps: Camp[];
  latitude: number | null;
  longitude: number | null;
  censusCountByCamp: Record<string, number>;
  rotationByCampId: Record<
    string,
    { status: CampRotationStatus["status"]; days: number | null }
  >;
  veldScoreByCamp: Record<string, number>;
  feedOnOfferKgDmPerHaByCamp: Record<string, number>;
}

export async function getCachedDashboardData(
  farmSlug: string,
): Promise<DashboardData> {
  const fetcher = unstable_cache(
    async (slug: string): Promise<DashboardData> => {
      return withFarmPrisma(slug, async (prisma) => {
        const [
          totalAnimals,
          animalGroupsBySpecies,
          prismaCamps,
          farmSettings,
          censusPopByCamp,
          rotationPayload,
          veldLatestByCamp,
          feedOnOfferLatestByCamp,
        ] = await Promise.all([
          // cross-species by design: dashboard groups by species explicitly
          // so the UI can render per-species totals AND a combined headline.
          prisma.animal.groupBy({
            by: ["species"],
            where: { status: "Active" },
            _count: { _all: true },
          }),
          prisma.animal.groupBy({
            by: ["species", "currentCamp"],
            where: { status: "Active" },
            _count: { _all: true },
          }),
          prisma.camp.findMany({ orderBy: { campName: "asc" } }),
          prisma.farmSettings.findFirst({ select: { latitude: true, longitude: true } }),
          getCensusPopulationByCamp(prisma),
          getRotationStatusByCamp(prisma),
          getLatestByCamp(prisma),
          getLatestCoverByCamp(prisma),
        ]);

        // Species totals
        const totalBySpecies: Record<string, number> = {};
        let totalAll = 0;
        for (const g of totalAnimals) {
          const sp = g.species || "cattle";
          totalBySpecies[sp] = g._count._all;
          totalAll += g._count._all;
        }

        // Per-species camp counts + combined animal counts
        const campCountsBySpecies: Record<string, Record<string, number>> = {};
        const campAnimalCounts: Record<string, number> = {};
        for (const g of animalGroupsBySpecies) {
          const sp = g.species || "cattle";
          if (!campCountsBySpecies[sp]) campCountsBySpecies[sp] = {};
          campCountsBySpecies[sp][g.currentCamp] = g._count._all;
          campAnimalCounts[g.currentCamp] = (campAnimalCounts[g.currentCamp] ?? 0) + g._count._all;
        }

        // Census game population per camp
        const censusCountByCamp: Record<string, number> = {};
        for (const row of censusPopByCamp) {
          censusCountByCamp[row.campId] = row.totalPopulation;
        }

        // Camps in snake_case for Camp type
        const camps: Camp[] = prismaCamps.map((c) => ({
          camp_id: c.campId,
          camp_name: c.campName,
          size_hectares: c.sizeHectares ?? undefined,
          water_source: c.waterSource ?? undefined,
          geojson: c.geojson ?? undefined,
          color: c.color ?? undefined,
        }));

        // Rotation status per camp
        const rotationByCampId: DashboardData["rotationByCampId"] = {};
        for (const c of rotationPayload.camps) {
          rotationByCampId[c.campId] = {
            status: c.status,
            days: c.daysGrazed ?? c.daysRested ?? null,
          };
        }

        // Veld scores per camp (Map → Record)
        const veldScoreByCamp: Record<string, number> = {};
        for (const [campId, entry] of veldLatestByCamp.entries()) {
          veldScoreByCamp[campId] = entry.score;
        }

        // Feed-on-offer per camp (Map → Record)
        const feedOnOfferKgDmPerHaByCamp: Record<string, number> = {};
        for (const [campId, entry] of feedOnOfferLatestByCamp.entries()) {
          feedOnOfferKgDmPerHaByCamp[campId] = entry.kgDmPerHa;
        }

        return {
          totalAll,
          totalBySpecies,
          campAnimalCounts,
          campCountsBySpecies,
          camps,
          latitude: farmSettings?.latitude ?? null,
          longitude: farmSettings?.longitude ?? null,
          censusCountByCamp,
          rotationByCampId,
          veldScoreByCamp,
          feedOnOfferKgDmPerHaByCamp,
        };
      });
    },
    ["dashboard-data"],
    {
      revalidate: 30,
      tags: [
        farmTag(farmSlug, "animals"),
        farmTag(farmSlug, "camps"),
        farmTag(farmSlug, "observations"),
      ],
    },
  );
  return fetcher(farmSlug);
}

// ── Cached: Notifications feed (30s) ─────────────────────────────────────────
// Served to the NotificationBell via /api/notifications.
// Tagged with both the farm-scoped notifications tag (cron writes fresh rows
// for the whole farm) and the per-user tag (mark-read mutations only affect
// the current user's view), so either mutation class can invalidate precisely
// what it changed without nuking the whole farm's cache.

export interface CachedNotification {
  id: string;
  type: string;
  severity: string;
  message: string;
  href: string;
  isRead: boolean;
  createdAt: string | Date;
  expiresAt?: string | Date | null;
}

export interface CachedNotificationsPayload {
  notifications: CachedNotification[];
  unreadCount: number;
}

export async function getCachedNotifications(
  farmSlug: string,
  userEmail: string,
): Promise<CachedNotificationsPayload> {
  const fetcher = unstable_cache(
    async (slug: string, email: string): Promise<CachedNotificationsPayload> => {
      void email; // key-only: the feed is shared per farm but we key by user
                  // so per-user invalidations (mark-read) land on distinct entries.
      return withFarmPrisma(slug, async (prisma) => {
        const now = new Date();
        const rows = (await prisma.notification.findMany({
          where: { expiresAt: { gt: now } },
          orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
          take: 30,
        })) as CachedNotification[];
        const unreadCount = rows.filter((n) => !n.isRead).length;
        return { notifications: rows, unreadCount };
      });
    },
    ["notifications-feed"],
    {
      revalidate: 30,
      tags: [
        farmTag(farmSlug, "notifications"),
        notificationTag(userEmail),
      ],
    },
  );
  return fetcher(farmSlug, userEmail);
}
