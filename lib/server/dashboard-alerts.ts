// lib/server/dashboard-alerts.ts
import type { PrismaClient } from "@prisma/client";
import type { ReproStats } from "@/lib/server/reproduction-analytics";
import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";
import type { LiveCampStatus } from "@/lib/server/camp-status";
import { getLatestCampConditions } from "@/lib/server/camp-status";
import { getRotationStatusByCamp } from "@/lib/server/rotation-engine";
import { getFarmSummary as getVeldSummary } from "@/lib/server/veld-score";
import { getFarmFeedOnOfferPayload } from "@/lib/server/feed-on-offer";
import { getDroughtPayload, type DroughtPayload } from "@/lib/server/drought";
import { cattleModule } from "@/lib/species/cattle";
import { sheepModule } from "@/lib/species/sheep";
import { gameModule } from "@/lib/species/game";
import type { SpeciesModule, SpeciesAlert, SpeciesId } from "@/lib/species/types";

// Registry of all species modules, keyed by id. The set of modules we actually
// query on each request is filtered by the farm's FarmSpeciesSettings — see
// `getEnabledSpeciesModules` below. Cattle is always included as a safe
// default (mirrors getCachedFarmSpeciesSettings semantics in lib/server/cached.ts).
const ALL_SPECIES_MODULES: Record<SpeciesId, SpeciesModule> = {
  cattle: cattleModule,
  sheep: sheepModule,
  game: gameModule,
};

export type AlertSource = SpeciesId | "farm";

export interface DashboardAlert {
  id: string;
  severity: "red" | "amber";
  icon: string; // lucide icon name as string
  message: string;
  count: number;
  href: string;
  species: AlertSource;
}

export interface DashboardAlerts {
  red: DashboardAlert[];
  amber: DashboardAlert[];
  totalCount: number;
}

export interface AlertThresholds {
  adgPoorDoerThreshold: number;     // default 0.7
  calvingAlertDays: number;         // default 14
  daysOpenLimit: number;            // default 365
  campGrazingWarningDays: number;   // default 7
  staleCampInspectionHours: number; // default 48
}

/**
 * Optional pre-fetched data to avoid duplicate queries when the caller
 * already has reproStats / campConditions available.
 *
 * Note: reproStats is kept for backward compatibility with cached.ts which
 * uses its presence to decide whether to skip the cache. It is no longer
 * consumed by getDashboardAlerts itself — species modules handle repro alerts.
 */
export interface PreFetchedAlertData {
  reproStats?: ReproStats;
  campConditions?: Map<string, LiveCampStatus>;
}

/**
 * Resolve the species modules to query for this farm. Reads FarmSpeciesSettings
 * via the request-scoped Prisma client and filters `ALL_SPECIES_MODULES` to the
 * enabled set. Cattle is always included (safe default — every farm has cattle
 * in our current data model, and the cached species-settings helper applies the
 * same fallback). On lookup failure we degrade to cattle-only so a transient DB
 * blip can't unintentionally surface alerts for species the farm doesn't run.
 */
async function getEnabledSpeciesModules(
  prisma: PrismaClient,
): Promise<SpeciesModule[]> {
  try {
    const rows = await prisma.farmSpeciesSettings.findMany({
      select: { species: true, enabled: true },
    });
    const enabled = new Set<string>(
      rows.filter((r) => r.enabled).map((r) => r.species),
    );
    enabled.add("cattle");
    return (Object.keys(ALL_SPECIES_MODULES) as SpeciesId[])
      .filter((id) => enabled.has(id))
      .map((id) => ALL_SPECIES_MODULES[id]);
  } catch {
    return [ALL_SPECIES_MODULES.cattle];
  }
}

function toThresholdsRecord(t: AlertThresholds): Record<string, number> {
  return {
    adgPoorDoerThreshold: t.adgPoorDoerThreshold,
    calvingAlertDays: t.calvingAlertDays,
    daysOpenLimit: t.daysOpenLimit,
    campGrazingWarningDays: t.campGrazingWarningDays,
    staleCampInspectionHours: t.staleCampInspectionHours,
  };
}

function speciesAlertToDashboardAlert(a: SpeciesAlert, species: AlertSource): DashboardAlert {
  return {
    id: a.id,
    severity: a.severity,
    icon: a.icon,
    message: a.message,
    count: a.count,
    href: a.href,
    species,
  };
}

export async function getDashboardAlerts(
  prisma: PrismaClient,
  farmSlug: string,
  thresholds: AlertThresholds,
  preFetched: PreFetchedAlertData = {},
): Promise<DashboardAlerts> {
  const {
    staleCampInspectionHours,
  } = thresholds;

  const now = new Date();
  const thresholdsRecord = toThresholdsRecord(thresholds);

  // Resolve which species modules to query for this farm (issue #203). We do
  // this first so the species-alert fan-out only hits enabled modules — sheep
  // alerts must not leak onto cattle-only farms.
  const enabledModules = await getEnabledSpeciesModules(prisma);

  // ── Parallel: species module alerts + farm-wide data ─────────────────────
  const [allSpeciesAlerts, withdrawalAnimals, campConditions, totalCamps, rotationPayload, veldSummary, feedOnOfferPayload, farmSettings] =
    await Promise.all([
      Promise.all(
        enabledModules.map((mod) =>
          mod.getAlerts(prisma, farmSlug, thresholdsRecord)
            .then((alerts) => alerts.map((a) => speciesAlertToDashboardAlert(a, mod.config.id)))
            .catch(() => [] as DashboardAlert[]),
        ),
      ),
      getAnimalsInWithdrawal(prisma),
      preFetched.campConditions ?? getLatestCampConditions(prisma),
      prisma.camp.count(),
      getRotationStatusByCamp(prisma, now).catch(() => null),
      getVeldSummary(prisma, now).catch(() => null),
      getFarmFeedOnOfferPayload(prisma, now).catch(() => null),
      prisma.farmSettings.findFirst({ select: { latitude: true, longitude: true } }).catch(() => null),
    ]);

  // ── Drought payload (needs lat/lng from farmSettings, best-effort) ─────────
  let droughtPayload: DroughtPayload | null = null;
  if (farmSettings?.latitude != null && farmSettings?.longitude != null) {
    droughtPayload = await getDroughtPayload(
      prisma,
      farmSettings.latitude,
      farmSettings.longitude,
    ).catch(() => null);
  }

  const speciesAlerts: DashboardAlert[] = allSpeciesAlerts.flat();

  // ── Stale camp inspections ─────────────────────────────────────────────────
  const staleThresholdMs = staleCampInspectionHours * 60 * 60 * 1000;
  const uninspectedCamps = totalCamps - campConditions.size;
  let staleCampCount = uninspectedCamps;
  for (const status of campConditions.values()) {
    const inspectedAt = new Date(status.last_inspected_at);
    const ageMs = now.getTime() - inspectedAt.getTime();
    if (ageMs > staleThresholdMs) staleCampCount++;
  }

  // ── Camp grazing ───────────────────────────────────────────────────────────
  let poorGrazingCount = 0;
  for (const status of campConditions.values()) {
    if (
      status.grazing_quality === "Poor" ||
      status.grazing_quality === "Overgrazed"
    ) {
      poorGrazingCount++;
    }
  }

  // ── Build alert arrays ────────────────────────────────────────────────────
  const red: DashboardAlert[] = [];
  const amber: DashboardAlert[] = [];

  // Aggregate species module alerts (split by severity)
  for (const alert of speciesAlerts) {
    if (alert.severity === "red") {
      red.push(alert);
    } else {
      amber.push(alert);
    }
  }

  // Red: animals in withdrawal (farm-wide, not species-specific)
  if (withdrawalAnimals.length > 0) {
    red.push({
      id: "in-withdrawal",
      severity: "red",
      icon: "FlaskConical",
      message:
        withdrawalAnimals.length === 1
          ? "1 animal in withdrawal period"
          : `${withdrawalAnimals.length} animals in withdrawal period`,
      count: withdrawalAnimals.length,
      href: `/${farmSlug}/admin/animals`,
      species: "farm",
    });
  }

  // Red: poor or overgrazed camps (farm-wide)
  if (poorGrazingCount > 0) {
    red.push({
      id: "poor-grazing",
      severity: "red",
      icon: "Tent",
      message:
        poorGrazingCount === 1
          ? "1 camp with poor or overgrazed pasture"
          : `${poorGrazingCount} camps with poor or overgrazed pasture`,
      count: poorGrazingCount,
      href: `/${farmSlug}/admin/performance`,
      species: "farm",
    });
  }

  // Rotation alerts (farm-wide): overstayed=red, overdue_rest=amber
  if (rotationPayload) {
    let overstayedCount = 0;
    let overdueRestCount = 0;
    for (const c of rotationPayload.camps) {
      if (c.status === "overstayed") overstayedCount++;
      else if (c.status === "overdue_rest") overdueRestCount++;
    }
    if (overstayedCount > 0) {
      red.push({
        id: "rotation-overstayed",
        severity: "red",
        icon: "Clock",
        message:
          overstayedCount === 1
            ? "1 camp overstayed (animals past max grazing days)"
            : `${overstayedCount} camps overstayed (animals past max grazing days)`,
        count: overstayedCount,
        href: `/${farmSlug}/admin/camps?tab=rotation`,
        species: "farm",
      });
    }
    if (overdueRestCount > 0) {
      amber.push({
        id: "rotation-overdue-rest",
        severity: "amber",
        icon: "AlertTriangle",
        message:
          overdueRestCount === 1
            ? "1 camp overdue for grazing (veld may be declining)"
            : `${overdueRestCount} camps overdue for grazing (veld may be declining)`,
        count: overdueRestCount,
        href: `/${farmSlug}/admin/camps?tab=rotation`,
        species: "farm",
      });
    }
  }

  // Veld condition alerts (farm-wide)
  if (veldSummary) {
    if (veldSummary.critical.length > 0) {
      const n = veldSummary.critical.length;
      red.push({
        id: "veld-critical",
        severity: "red",
        icon: "AlertTriangle",
        message: n === 1
          ? "1 camp in critical veld condition (score < 3)"
          : `${n} camps in critical veld condition (score < 3)`,
        count: n,
        href: `/${farmSlug}/tools/veld`,
        species: "farm",
      });
    }

    if (veldSummary.declining.length > 0) {
      const n = veldSummary.declining.length;
      amber.push({
        id: "veld-declining",
        severity: "amber",
        icon: "TrendingDown",
        message: n === 1
          ? "1 camp showing declining veld trend"
          : `${n} camps showing declining veld trend`,
        count: n,
        href: `/${farmSlug}/tools/veld`,
        species: "farm",
      });
    }

    if (veldSummary.overdue.length > 0) {
      const n = veldSummary.overdue.length;
      amber.push({
        id: "veld-overdue-assessment",
        severity: "amber",
        icon: "CalendarClock",
        message: n === 1
          ? "1 camp overdue for veld assessment (>180 days)"
          : `${n} camps overdue for veld assessment (>180 days)`,
        count: n,
        href: `/${farmSlug}/tools/veld`,
        species: "farm",
      });
    }
  }

  // Feed on Offer alerts (farm-wide)
  if (feedOnOfferPayload) {
    const { summary: feedOnOfferSummary } = feedOnOfferPayload;
    if (feedOnOfferSummary.campsCritical > 0) {
      const n = feedOnOfferSummary.campsCritical;
      red.push({
        id: "feed-on-offer-critical",
        severity: "red",
        icon: "AlertTriangle",
        message: n === 1
          ? "1 camp with critical feed levels (< 500 kg DM/ha)"
          : `${n} camps with critical feed levels (< 500 kg DM/ha)`,
        count: n,
        href: `/${farmSlug}/tools/feed-on-offer`,
        species: "farm",
      });
    }

    if (feedOnOfferSummary.campsLow > 0) {
      const n = feedOnOfferSummary.campsLow;
      amber.push({
        id: "feed-on-offer-low",
        severity: "amber",
        icon: "Wheat",
        message: n === 1
          ? "1 camp with low feed levels (< 1,000 kg DM/ha)"
          : `${n} camps with low feed levels (< 1,000 kg DM/ha)`,
        count: n,
        href: `/${farmSlug}/tools/feed-on-offer`,
        species: "farm",
      });
    }

    if (feedOnOfferSummary.campsStaleReading > 0) {
      const n = feedOnOfferSummary.campsStaleReading;
      amber.push({
        id: "feed-on-offer-stale-reading",
        severity: "amber",
        icon: "CalendarClock",
        message: n === 1
          ? "1 camp with outdated cover reading (> 30 days)"
          : `${n} camps with outdated cover readings (> 30 days)`,
        count: n,
        href: `/${farmSlug}/tools/feed-on-offer`,
        species: "farm",
      });
    }
  }

  // Drought alerts (farm-wide, based on SPI-3)
  if (droughtPayload?.spi3 != null) {
    const { value: spi3 } = droughtPayload.spi3;
    if (spi3 <= -1.5) {
      red.push({
        id: "drought-severe",
        severity: "red",
        icon: "CloudOff",
        message: `Severe drought conditions — SPI-3 = ${spi3.toFixed(2)}`,
        count: 1,
        href: `/${farmSlug}/tools/drought`,
        species: "farm",
      });
    } else if (spi3 <= -1.0) {
      amber.push({
        id: "drought-moderate",
        severity: "amber",
        icon: "Cloud",
        message: `Moderate drought conditions — SPI-3 = ${spi3.toFixed(2)}`,
        count: 1,
        href: `/${farmSlug}/tools/drought`,
        species: "farm",
      });
    }
  }

  // Amber: stale camp inspections (farm-wide)
  if (staleCampCount > 0) {
    amber.push({
      id: "stale-inspections",
      severity: "amber",
      icon: "ClipboardCheck",
      message:
        staleCampCount === 1
          ? `1 camp not inspected within ${staleCampInspectionHours}h`
          : `${staleCampCount} camps not inspected within ${staleCampInspectionHours}h`,
      count: staleCampCount,
      href: `/${farmSlug}/admin/observations`,
      species: "farm",
    });
  }

  return {
    red,
    amber,
    totalCount: red.length + amber.length,
  };
}
