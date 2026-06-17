// lib/species/sheep/index.ts — Sheep species module implementation

import type { PrismaClient } from "@prisma/client";
import type {
  SpeciesModule,
  SpeciesDashboardData,
  SpeciesReproStats,
  SpeciesAlert,
} from "../types";
import { scoped } from "@/lib/server/species-scoped-prisma";
import { SHEEP_CONFIG } from "./config";
import {
  getUpcomingLambings,
  calcLambingPercentage,
  daysSinceLastShearing,
  getDosingOverdue,
} from "./analytics";

export { SHEEP_CONFIG } from "./config";

// ── Constants ─────────────────────────────────────────────────────────────────

const SPECIES = "sheep" as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const GESTATION_DAYS = 150;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * MS_PER_DAY);
}

// ── Dashboard Data ────────────────────────────────────────────────────────────

async function getDashboardData(
  prisma: PrismaClient,
): Promise<SpeciesDashboardData> {
  // scoped() forwards args verbatim; the facade returns Prisma's broadest
  // groupBy shape (documented trade-off) so re-narrow to what this query's
  // by/_count selection produces — behaviour-identical. `scoped()` injects
  // `{ species: "sheep" }`; status stays caller-controlled.
  const [categoryRows, campRows] = await Promise.all([
    scoped(prisma, SPECIES).animal.groupBy({
      by: ["category"],
      where: { status: "Active" },
      _count: { id: true },
    }) as unknown as Promise<
      Array<{ category: string; _count: { id: number } }>
    >,
    scoped(prisma, SPECIES).animal.groupBy({
      by: ["currentCamp"],
      where: { status: "Active" },
      _count: { id: true },
    }) as unknown as Promise<
      Array<{ currentCamp: string; _count: { id: number } }>
    >,
  ]);

  const byCategory: Record<string, number> = {};
  let activeCount = 0;
  for (const row of categoryRows) {
    byCategory[row.category] = row._count.id;
    activeCount += row._count.id;
  }

  const byCamp: Record<string, number> = {};
  for (const row of campRows) {
    byCamp[row.currentCamp] = row._count.id;
  }

  const ewesActive = (byCategory["Ewe"] ?? 0) + (byCategory["Maiden Ewe"] ?? 0);
  const ramsActive = byCategory["Ram"] ?? 0;
  const lambsActive =
    (byCategory["Lamb"] ?? 0) + (byCategory["Ewe Lamb"] ?? 0);

  return {
    totalCount: activeCount,
    activeCount,
    byCategory,
    byCamp,
    reproStats: null,
    speciesSpecific: { ewesActive, ramsActive, lambsActive },
  };
}

// ── Repro Stats ───────────────────────────────────────────────────────────────

async function getReproStats(prisma: PrismaClient): Promise<SpeciesReproStats> {
  const cutoff18m = daysAgo(548); // ~18 months
  const cutoff12m = daysAgo(365);

  const [joiningObs, lambingObs, camps] = await Promise.all([
    scoped(prisma, SPECIES).observation.findMany({
      where: { type: "joining", observedAt: { gte: cutoff18m } },
      select: { animalId: true, campId: true, observedAt: true, details: true },
    }),
    scoped(prisma, SPECIES).observation.findMany({
      where: { type: "lambing", observedAt: { gte: cutoff18m } },
      select: { animalId: true, campId: true, observedAt: true },
    }),
    scoped(prisma, SPECIES).camp.findMany({
      select: { campId: true, campName: true },
    }),
  ]);

  const campMap = new Map(camps.map((c) => [c.campId, c.campName]));

  const joinings12m = joiningObs.filter((o) => o.observedAt >= cutoff12m);
  const lambings12m = lambingObs.filter((o) => o.observedAt >= cutoff12m);

  const lambingPercentage = calcLambingPercentage(
    joinings12m.length,
    lambings12m.length,
  );

  const upcomingBirths = getUpcomingLambings(joiningObs, campMap);

  return {
    pregnancyRate: null,
    birthRate: lambingPercentage,
    avgBirthIntervalDays: null,
    upcomingBirths,
    lambingPercentage,
    lambings12m: lambings12m.length,
    joinings12m: joinings12m.length,
  };
}

// ── Alerts ────────────────────────────────────────────────────────────────────

async function getAlerts(
  prisma: PrismaClient,
  farmSlug: string,
  _thresholds: Record<string, number>,
): Promise<SpeciesAlert[]> {
  const alerts: SpeciesAlert[] = [];

  const now = new Date();
  const cutoff18m = daysAgo(548);

  const [joiningObs, lambingObs, dosingObs, shearingObs, ewesCount, activeAnimals] =
    await Promise.all([
      scoped(prisma, SPECIES).observation.findMany({
        where: { type: "joining", observedAt: { gte: cutoff18m } },
        select: { animalId: true, campId: true, observedAt: true, details: true },
      }),
      scoped(prisma, SPECIES).observation.findMany({
        where: { type: "lambing", observedAt: { gte: cutoff18m } },
        select: { animalId: true, observedAt: true },
      }),
      scoped(prisma, SPECIES).observation.findMany({
        where: { type: "dosing" },
        select: { animalId: true, observedAt: true },
      }),
      scoped(prisma, SPECIES).observation.findMany({
        where: { type: "shearing" },
        select: { observedAt: true },
        orderBy: { observedAt: "desc" },
        take: 1,
      }),
      scoped(prisma, SPECIES).animal.count({
        where: {
          status: "Active",
          category: { in: ["Ewe", "Maiden Ewe"] },
        },
      }),
      // Active roster — every animal-derived alert below (lambing imminent,
      // lambing overdue, dosing overdue) intersects this set so a deceased/
      // sold ewe's retained joining/dosing observation can't inflate a count.
      // scoped() observation reads carry NO status filter; scoped().animal
      // injects status:Active. Matches Herd Triage (get-triage.ts) — ADR-0010.
      scoped(prisma, SPECIES).animal.findMany({
        where: { status: "Active" },
        select: { animalId: true },
        take: 10_000,
      }),
    ]);

  // The active population. Observations persist after an animal dies / is sold,
  // so every id harvested from observation history (joining, dosing) is
  // intersected with this set before it counts toward an alert.
  const activeIds = new Set(activeAnimals.map((a) => a.animalId));

  // 1. Lambing imminent (< 14 days away) — active ewes only.
  const imminentLambings = joiningObs.filter((obs) => {
    if (!obs.animalId || !activeIds.has(obs.animalId)) return false;
    const expectedMs =
      obs.observedAt.getTime() + GESTATION_DAYS * MS_PER_DAY;
    const daysAway = (expectedMs - now.getTime()) / MS_PER_DAY;
    return daysAway >= 0 && daysAway <= 14;
  });

  if (imminentLambings.length > 0) {
    alerts.push({
      id: "sheep-lambing-imminent",
      severity: "amber",
      icon: "Baby",
      message: `${imminentLambings.length} ewe${imminentLambings.length === 1 ? "" : "s"} due to lamb within 14 days`,
      count: imminentLambings.length,
      href: `/${farmSlug}/sheep/reproduction`,
    });
  }

  // 2. Lambing overdue (> 160 days since joining, no lambing obs after)
  const lambingByAnimal = new Map<string, Date[]>();
  for (const obs of lambingObs) {
    if (!obs.animalId) continue;
    const existing = lambingByAnimal.get(obs.animalId) ?? [];
    lambingByAnimal.set(obs.animalId, [...existing, obs.observedAt]);
  }

  const overdueJoinings = joiningObs.filter((obs) => {
    if (!obs.animalId || !activeIds.has(obs.animalId)) return false;
    const daysSinceJoining =
      (now.getTime() - obs.observedAt.getTime()) / MS_PER_DAY;
    if (daysSinceJoining <= 160) return false;

    const animalLambings = lambingByAnimal.get(obs.animalId) ?? [];
    const hasLambingAfterJoining = animalLambings.some(
      (lambDate) => lambDate > obs.observedAt,
    );
    return !hasLambingAfterJoining;
  });

  if (overdueJoinings.length > 0) {
    alerts.push({
      id: "sheep-lambing-overdue",
      severity: "red",
      icon: "AlertTriangle",
      message: `${overdueJoinings.length} ewe${overdueJoinings.length === 1 ? "" : "s"} overdue to lamb`,
      count: overdueJoinings.length,
      href: `/${farmSlug}/sheep/reproduction`,
    });
  }

  // 3. Dosing overdue (no dosing in last 90 days AND active ewes exist)
  if (ewesCount > 0) {
    const overdueAnimals = getDosingOverdue(dosingObs, 90).filter((id) =>
      activeIds.has(id),
    );
    if (overdueAnimals.length > 0) {
      alerts.push({
        id: "sheep-dosing-due",
        severity: "amber",
        icon: "Droplets",
        message: `${overdueAnimals.length} sheep overdue for dosing`,
        count: overdueAnimals.length,
        href: `/${farmSlug}/sheep/health`,
      });
    }
  }

  // 4. Shearing due (last shearing > 300 days ago or never sheared)
  const daysSinceShear = daysSinceLastShearing(shearingObs);
  if (daysSinceShear === null || daysSinceShear > 300) {
    alerts.push({
      id: "sheep-shearing-due",
      severity: "amber",
      icon: "Scissors",
      message:
        daysSinceShear === null
          ? "No shearing on record — shearing may be due"
          : `Last shearing was ${daysSinceShear} days ago — shearing due`,
      count: 1,
      href: `/${farmSlug}/sheep/wool`,
    });
  }

  // 5. Predation loss in last 30 days (jackal, caracal, leopard)
  const predationRows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*) as count FROM GamePredationEvent
     WHERE date >= date('now', '-30 days')
     AND predatorSpecies IN ('jackal', 'Jackal', 'caracal', 'Caracal', 'leopard', 'Leopard')`,
  );

  const predationCount = Number(predationRows[0]?.count ?? 0);
  if (predationCount > 0) {
    alerts.push({
      id: "sheep-predation",
      severity: "red",
      icon: "AlertTriangle",
      message: `${predationCount} predation event${predationCount === 1 ? "" : "s"} recorded in the last 30 days`,
      count: predationCount,
      href: `/${farmSlug}/sheep/losses`,
    });
  }

  return alerts;
}

// ── Module Export ─────────────────────────────────────────────────────────────

export const sheepModule: SpeciesModule = {
  config: SHEEP_CONFIG,

  getDashboardData,
  getReproStats,
  getAlerts,

  getLsuValues(farmOverrides?: Record<string, number>): Record<string, number> {
    return { ...SHEEP_CONFIG.defaultLsuValues, ...farmOverrides };
  },

  validateCategory(category: string): boolean {
    return SHEEP_CONFIG.categories.some((c) => c.value === category);
  },

  validateObservationType(type: string): boolean {
    return SHEEP_CONFIG.observationTypes.some((t) => t.value === type);
  },
};
