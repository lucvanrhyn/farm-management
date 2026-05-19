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

// ADR-0005: the pure composition core lives in `./alerts/compose`. Import it
// for the shell's own delegation AND re-export it so existing import sites
// and new callers can reach it from the same module that owns the alert
// types. `compose.ts` imports the type-only surface (AlertThresholds /
// DashboardAlert / DashboardAlerts) back from this file — that direction is
// types-only, so the cycle is erased at runtime.
import { composeAlerts } from "@/lib/server/alerts/compose";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
export { composeAlerts };
export type { AlertInputs } from "@/lib/server/alerts/compose";

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
      take: 50,
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
  mode?: SpeciesId,
): Promise<DashboardAlerts> {
  const now = new Date();
  const thresholdsRecord = toThresholdsRecord(thresholds);

  // Resolve which species modules to query for this farm (issue #203). We do
  // this first so the species-alert fan-out only hits enabled modules — sheep
  // alerts must not leak onto cattle-only farms.
  //
  // Issue #225: when the caller passes `mode` (i.e. the admin dashboard home
  // reading the FarmMode cookie), narrow further to the active species so the
  // alert panel only reflects that mode's herd. Farm-wide alerts (rotation,
  // veld, feed-on-offer, drought, stale inspections) are not species-scoped
  // and continue to fire regardless of mode.
  const allEnabled = await getEnabledSpeciesModules(prisma);
  const enabledModules = mode
    ? allEnabled.filter((m) => m.config.id === mode)
    : allEnabled;

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
      // Farm-wide camp total (drives stale-inspection ratio) — not
      // species-scoped. crossSpecies() forwards args verbatim.
      crossSpecies(prisma, "analytics-rollup").camp.count(),
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

  // ADR-0005: every severity / message / count decision now lives in the
  // single pure core. This shell's only job is the eight-way fetch fan-out
  // above; it hands the fetched sources to `composeAlerts` unchanged. The
  // signature is preserved so all five callers are untouched.
  return composeAlerts({
    campConditions,
    totalCamps,
    withdrawalAnimals,
    rotationPayload,
    veldSummary,
    feedOnOfferPayload,
    droughtPayload,
    speciesAlerts,
    thresholds,
    farmSlug,
    now,
  });
}
