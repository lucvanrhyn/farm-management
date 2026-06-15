// lib/species/cattle/index.ts — Cattle species module implementation

import type { PrismaClient } from "@prisma/client";
import type {
  SpeciesModule,
  SpeciesDashboardData,
  SpeciesReproStats,
  SpeciesAlert,
} from "../types";
import { scoped } from "@/lib/server/species-scoped-prisma";
import { CATTLE_CONFIG } from "./config";
import { getReproStatsForSpecies } from "../shared/repro-engine";
import { detectPoorDoers } from "./poor-doer";

// Re-export config for direct access
export { CATTLE_CONFIG } from "./config";

const CATTLE_REPRO_CONFIG = {
  gestationDays: CATTLE_CONFIG.gestationDays,
  voluntaryWaitingDays: CATTLE_CONFIG.voluntaryWaitingDays,
  estrusCycleDays: CATTLE_CONFIG.estrusCycleDays,
  heatObsType: "heat_detection",
  inseminationObsType: "insemination",
  pregnancyScanObsType: "pregnancy_scan",
  birthObsType: "calving",
  species: "cattle",
} as const;

export const cattleModule: SpeciesModule = {
  config: CATTLE_CONFIG,

  async getDashboardData(prisma: PrismaClient): Promise<SpeciesDashboardData> {
    // scoped() forwards args verbatim; the facade returns Prisma's broadest
    // groupBy shape (documented trade-off) so re-narrow to what this query's
    // by/_count selection produces — behaviour-identical. `scoped()` injects
    // `{ species: "cattle" }`; status stays caller-controlled.
    const animals = (await scoped(prisma, "cattle").animal.groupBy({
      by: ["category"],
      where: { status: "Active" },
      _count: { id: true },
    })) as unknown as Array<{ category: string; _count: { id: number } }>;

    const byCategory: Record<string, number> = {};
    let activeCount = 0;
    for (const row of animals) {
      byCategory[row.category] = row._count.id;
      activeCount += row._count.id;
    }

    const campCounts = (await scoped(prisma, "cattle").animal.groupBy({
      by: ["currentCamp"],
      where: { status: "Active" },
      _count: { id: true },
    })) as unknown as Array<{ currentCamp: string; _count: { id: number } }>;
    const byCamp: Record<string, number> = {};
    for (const row of campCounts) {
      byCamp[row.currentCamp] = row._count.id;
    }

    return {
      totalCount: activeCount,
      activeCount,
      byCategory,
      byCamp,
      reproStats: null,
      speciesSpecific: {},
    };
  },

  async getReproStats(prisma: PrismaClient): Promise<SpeciesReproStats> {
    return getReproStatsForSpecies(prisma, CATTLE_REPRO_CONFIG);
  },

  async getAlerts(
    prisma: PrismaClient,
    farmSlug: string,
    thresholds: Record<string, number>,
  ): Promise<SpeciesAlert[]> {
    const calvingAlertDays = thresholds.calvingAlertDays ?? 14;
    const daysOpenLimit = thresholds.daysOpenLimit ?? 365;
    const adgPoorDoerThreshold = thresholds.adgPoorDoerThreshold ?? 0.7;

    const reproStats = await getReproStatsForSpecies(prisma, CATTLE_REPRO_CONFIG);

    // ── Calving tiers ────────────────────────────────────────────────────────
    const overdueCounts = reproStats.upcomingBirths.filter(
      (c) => c.daysAway < 0,
    ).length;
    const due7dCount = reproStats.upcomingBirths.filter(
      (c) => c.daysAway >= 0 && c.daysAway <= 7,
    ).length;
    const due14dCount = reproStats.upcomingBirths.filter(
      (c) => c.daysAway > 7 && c.daysAway <= calvingAlertDays,
    ).length;

    // ── Open cows ────────────────────────────────────────────────────────────
    const daysOpenRecords = (
      reproStats as { daysOpen?: { daysOpen: number | null; isExtended: boolean }[] }
    ).daysOpen ?? [];
    const openCowsOverLimit = daysOpenRecords.filter(
      (d) =>
        (d.daysOpen !== null && d.daysOpen > daysOpenLimit) ||
        (d.daysOpen === null && d.isExtended),
    ).length;

    // ── Poor doers (weighing) ────────────────────────────────────────────────
    // Detection is shared with Herd Triage via the pure `detectPoorDoers`
    // helper (lib/species/cattle/poor-doer.ts). The alert COUNTs the
    // per-animal ids; Triage consumes the ids themselves. Output of THIS
    // alert is byte-identical to the previous inline block.
    const weighingObs = await scoped(prisma, "cattle").observation.findMany({
      where: { type: "weighing", animalId: { not: null } },
      select: { animalId: true, observedAt: true, details: true },
      orderBy: { observedAt: "asc" },
    });

    const poorDoerCount = detectPoorDoers(weighingObs, adgPoorDoerThreshold).length;

    // ── Build alert list ─────────────────────────────────────────────────────
    const alerts: SpeciesAlert[] = [];

    if (overdueCounts > 0) {
      alerts.push({
        id: "overdue-calvings",
        severity: "red",
        icon: "Baby",
        message:
          overdueCounts === 1
            ? "1 animal overdue to calve"
            : `${overdueCounts} animals overdue to calve`,
        count: overdueCounts,
        href: `/${farmSlug}/admin/reproduction`,
      });
    }

    if (due7dCount > 0) {
      alerts.push({
        id: "calvings-due-7d",
        severity: "amber",
        icon: "Baby",
        message:
          due7dCount === 1
            ? "1 animal due to calve within 7 days"
            : `${due7dCount} animals due to calve within 7 days`,
        count: due7dCount,
        href: `/${farmSlug}/admin/reproduction`,
      });
    }

    if (due14dCount > 0 && calvingAlertDays > 7) {
      alerts.push({
        id: "calvings-due-14d",
        severity: "amber",
        icon: "Baby",
        message:
          due14dCount === 1
            ? `1 animal due to calve within ${calvingAlertDays} days`
            : `${due14dCount} animals due to calve within ${calvingAlertDays} days`,
        count: due14dCount,
        href: `/${farmSlug}/admin/reproduction`,
      });
    }

    if (openCowsOverLimit > 0) {
      alerts.push({
        id: "open-cows",
        severity: "amber",
        icon: "Calendar",
        message:
          openCowsOverLimit === 1
            ? `1 cow open beyond ${daysOpenLimit} days`
            : `${openCowsOverLimit} cows open beyond ${daysOpenLimit} days`,
        count: openCowsOverLimit,
        href: `/${farmSlug}/admin/reproduction`,
      });
    }

    if (poorDoerCount > 0) {
      alerts.push({
        id: "poor-doers",
        severity: "amber",
        icon: "TrendingDown",
        message:
          poorDoerCount === 1
            ? `1 animal with low ADG (below ${adgPoorDoerThreshold} kg/day)`
            : `${poorDoerCount} animals with low ADG (below ${adgPoorDoerThreshold} kg/day)`,
        count: poorDoerCount,
        href: `/${farmSlug}/admin/animals`,
      });
    }

    return alerts;
  },

  getLsuValues(farmOverrides?: Record<string, number>): Record<string, number> {
    return { ...CATTLE_CONFIG.defaultLsuValues, ...farmOverrides };
  },

  validateCategory(category: string): boolean {
    return CATTLE_CONFIG.categories.some((c) => c.value === category);
  },

  validateObservationType(type: string): boolean {
    return CATTLE_CONFIG.observationTypes.some((t) => t.value === type);
  },
};
