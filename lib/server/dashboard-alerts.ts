// lib/server/dashboard-alerts.ts
import type { PrismaClient } from "@prisma/client";
import type { ReproStats } from "@/lib/server/reproduction-analytics";
import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";
import type { LiveCampStatus } from "@/lib/server/camp-status";
import { getLatestCampConditions } from "@/lib/server/camp-status";
import { getRotationStatusByCamp } from "@/lib/server/rotation-engine";
import { getFarmSummary as getVeldSummary } from "@/lib/server/veld-score";
import { getFarmFooPayload } from "@/lib/server/foo";
import { getDroughtPayload, type DroughtPayload } from "@/lib/server/drought";
import { cattleModule } from "@/lib/species/cattle";
import { sheepModule } from "@/lib/species/sheep";
import { gameModule } from "@/lib/species/game";
import type { SpeciesModule, SpeciesAlert, SpeciesId } from "@/lib/species/types";

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

// All modules that contribute species-level alerts
const SPECIES_MODULES: SpeciesModule[] = [cattleModule, sheepModule, gameModule];

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

  // ── Parallel: species module alerts + farm-wide data ─────────────────────
  const [allSpeciesAlerts, withdrawalAnimals, campConditions, totalCamps, rotationPayload, veldSummary, fooPayload, farmSettings] =
    await Promise.all([
      Promise.all(
        SPECIES_MODULES.map((mod) =>
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
      getFarmFooPayload(prisma, now).catch(() => null),
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

  // FOO (Feed on Offer) alerts (farm-wide)
  if (fooPayload) {
    const { summary: fooSummary } = fooPayload;
    if (fooSummary.campsCritical > 0) {
      const n = fooSummary.campsCritical;
      red.push({
        id: "foo-critical",
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

    if (fooSummary.campsLow > 0) {
      const n = fooSummary.campsLow;
      amber.push({
        id: "foo-low",
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

    if (fooSummary.campsStaleReading > 0) {
      const n = fooSummary.campsStaleReading;
      amber.push({
        id: "foo-stale-reading",
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
