// lib/species/shared/repro-engine.ts — Parameterized reproduction analytics engine

import type { PrismaClient } from "@prisma/client";
import type { SpeciesReproStats, UpcomingBirth } from "../types";

// ── Engine Config ──────────────────────────────────────────────────────────────

export interface ReproEngineConfig {
  gestationDays: number;
  voluntaryWaitingDays: number;
  estrusCycleDays: number;
  heatObsType: string;
  inseminationObsType: string;
  pregnancyScanObsType: string;
  birthObsType: string;
  species: string;
}

// ── Per-cycle pregnancy rate ───────────────────────────────────────────────────

export interface PregnancyRateCycle {
  label: string;
  windowStart: string;
  windowEnd: string;
  eligibleCount: number;
  pregnantCount: number;
  rate: number;
}

// ── Days open per animal ───────────────────────────────────────────────────────

export interface DaysOpenRecord {
  animalId: string;
  birthDate: Date;
  conceptionDate: Date | null;
  daysOpen: number | null;
  isExtended: boolean;
}

// ── Extended return type (merges into SpeciesReproStats via index signature) ───

export interface SpeciesReproStatsExtended extends SpeciesReproStats {
  inHeat7d: number;
  inseminations30d: number;
  birthsDue30d: number;
  scanCounts: { pregnant: number; empty: number; uncertain: number };
  conceptionRate: number | null;
  pregnancyRateByCycle: PregnancyRateCycle[];
  daysOpen: DaysOpenRecord[];
  avgDaysOpen: number | null;
  weaningRate: number | null;
}

// ── Private helpers ────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function daysFromNow(date: Date): number {
  return Math.round((date.getTime() - Date.now()) / 86_400_000);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function parseDetails(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

// ── Engine ────────────────────────────────────────────────────────────────────

/**
 * Parameterized reproduction analytics engine — works for any species.
 *
 * Filters all queries by `config.species` so results are isolated per species.
 * Returns a fully-populated SpeciesReproStatsExtended object.
 */
export async function getReproStatsForSpecies(
  prisma: PrismaClient,
  config: ReproEngineConfig,
): Promise<SpeciesReproStatsExtended> {
  const {
    gestationDays,
    voluntaryWaitingDays,
    estrusCycleDays,
    heatObsType,
    inseminationObsType,
    pregnancyScanObsType,
    birthObsType,
    species,
  } = config;

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const eighteenMonthsAgo = new Date();
  eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  const selectFields = {
    id: true,
    type: true,
    animalId: true,
    campId: true,
    observedAt: true,
    loggedBy: true,
    details: true,
  } as const;

  // Derive the set of animal IDs belonging to this species for observation filtering.
  // We join via the Animal table to ensure species isolation.
  const speciesAnimalIds = await prisma.animal
    .findMany({
      where: { species },
      select: { id: true },
    })
    .then((rows) => rows.map((r) => r.id));

  const animalIdFilter =
    speciesAnimalIds.length > 0 ? { in: speciesAnimalIds } : { in: [] as string[] };

  const [reproObs, birthObs, allCamps] = await Promise.all([
    prisma.observation.findMany({
      where: {
        type: { in: [heatObsType, inseminationObsType, pregnancyScanObsType] },
        observedAt: { gte: twelveMonthsAgo },
        animalId: animalIdFilter,
      },
      orderBy: { observedAt: "desc" },
      select: selectFields,
    }),
    prisma.observation.findMany({
      where: {
        type: birthObsType,
        observedAt: { gte: eighteenMonthsAgo },
        animalId: animalIdFilter,
      },
      orderBy: { observedAt: "asc" },
      select: selectFields,
    }),
    prisma.camp.findMany({ select: { campId: true, campName: true } }),
  ]);

  type ObsRow = (typeof reproObs)[0];

  const campMap = new Map(allCamps.map((c) => [c.campId, c.campName]));

  // ── Activity KPIs ─────────────────────────────────────────────────────────

  const inHeat7d = new Set(
    reproObs
      .filter(
        (o) =>
          o.type === heatObsType &&
          o.observedAt >= sevenDaysAgo &&
          o.animalId,
      )
      .map((o) => o.animalId as string),
  ).size;

  const inseminations30d = reproObs.filter(
    (o) => o.type === inseminationObsType && o.observedAt >= thirtyDaysAgo,
  ).length;

  // ── Scan results (latest scan per animal) ─────────────────────────────────

  const latestScanByAnimal = new Map<string, ObsRow>();
  for (const obs of reproObs.filter(
    (o) => o.type === pregnancyScanObsType && o.animalId,
  )) {
    if (!latestScanByAnimal.has(obs.animalId!)) {
      latestScanByAnimal.set(obs.animalId!, obs);
    }
  }

  const scanCounts = { pregnant: 0, empty: 0, uncertain: 0 };
  for (const obs of latestScanByAnimal.values()) {
    const d = parseDetails(obs.details);
    const result = (d.result ?? "uncertain") as keyof typeof scanCounts;
    if (result in scanCounts) scanCounts[result]++;
  }

  const scanTotal = scanCounts.pregnant + scanCounts.empty;
  const conceptionRate =
    scanTotal > 0 ? Math.round((scanCounts.pregnant / scanTotal) * 100) : null;

  // ── Pregnancy Rate (overall) ──────────────────────────────────────────────

  const femalesWithReproEvents = new Set(
    reproObs.filter((o) => o.animalId).map((o) => o.animalId as string),
  ).size;
  const pregnancyRate =
    femalesWithReproEvents > 0
      ? Math.round((scanCounts.pregnant / femalesWithReproEvents) * 100)
      : null;

  // ── Birth Rate ────────────────────────────────────────────────────────────

  const births12m = birthObs.filter((o) => o.observedAt >= twelveMonthsAgo);
  const totalInseminations12m = reproObs.filter(
    (o) => o.type === inseminationObsType,
  ).length;
  const liveBirths12m = births12m.filter(
    (o) => parseDetails(o.details).calf_status === "live",
  ).length;
  const birthRate =
    totalInseminations12m > 0
      ? Math.round((liveBirths12m / totalInseminations12m) * 100)
      : null;

  // ── Avg Birth Interval ────────────────────────────────────────────────────

  const birthsByAnimal = new Map<string, Date[]>();
  for (const obs of birthObs) {
    if (!obs.animalId) continue;
    const existing = birthsByAnimal.get(obs.animalId) ?? [];
    birthsByAnimal.set(obs.animalId, [...existing, obs.observedAt]);
  }

  const intervals: number[] = [];
  for (const dates of birthsByAnimal.values()) {
    if (dates.length < 2) continue;
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(
        (sorted[i].getTime() - sorted[i - 1].getTime()) / 86_400_000,
      );
    }
  }
  const avgBirthIntervalDays =
    intervals.length > 0
      ? Math.round(
          intervals.reduce((sum, v) => sum + v, 0) / intervals.length,
        )
      : null;

  // ── Upcoming Births ───────────────────────────────────────────────────────

  const latestInsemByAnimal = new Map<string, ObsRow>();
  for (const obs of reproObs.filter(
    (o) => o.type === inseminationObsType && o.animalId,
  )) {
    if (!latestInsemByAnimal.has(obs.animalId!)) {
      latestInsemByAnimal.set(obs.animalId!, obs);
    }
  }

  const candidateIds = new Set<string>([
    ...Array.from(latestScanByAnimal.entries())
      .filter(([, o]) => parseDetails(o.details).result === "pregnant")
      .map(([id]) => id),
    ...latestInsemByAnimal.keys(),
  ]);

  const upcomingBirths: UpcomingBirth[] = [];
  for (const animalId of candidateIds) {
    const scanObs = latestScanByAnimal.get(animalId);
    const insemObs = latestInsemByAnimal.get(animalId);
    const useScan =
      scanObs != null && parseDetails(scanObs.details).result === "pregnant";
    const baseObs = useScan ? scanObs! : insemObs;
    if (!baseObs) continue;

    const expectedDate = addDays(baseObs.observedAt, gestationDays);
    const daysAway = daysFromNow(expectedDate);
    if (daysAway < -7 || daysAway > 90) continue;

    upcomingBirths.push({
      animalId,
      campId: baseObs.campId,
      campName: campMap.get(baseObs.campId) ?? baseObs.campId,
      expectedDate,
      daysAway,
      source: useScan ? "scan" : "insemination",
    });
  }
  upcomingBirths.sort((a, b) => a.daysAway - b.daysAway);

  const birthsDue30d = upcomingBirths.filter(
    (c) => c.daysAway >= 0 && c.daysAway <= 30,
  ).length;

  // ── Per-cycle Pregnancy Rate ───────────────────────────────────────────────

  const inseminations = reproObs
    .filter((o) => o.type === inseminationObsType)
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

  const pregnancyRateByCycle: PregnancyRateCycle[] = [];
  if (inseminations.length > 0) {
    const seasonStart = inseminations[0].observedAt;
    const NUM_CYCLES = 6;

    const eligibleAnimals = new Set(
      reproObs.filter((o) => o.animalId).map((o) => o.animalId as string),
    );

    const confirmedPregnantOn = new Map<string, Date>();
    for (const [id, obs] of latestScanByAnimal.entries()) {
      if (parseDetails(obs.details).result === "pregnant") {
        confirmedPregnantOn.set(id, obs.observedAt);
      }
    }

    for (let c = 0; c < NUM_CYCLES; c++) {
      const windowStart = addDays(seasonStart, c * estrusCycleDays);
      const windowEnd = addDays(
        seasonStart,
        (c + 1) * estrusCycleDays - 1,
      );
      if (windowStart > new Date()) break;

      const eligibleCount = eligibleAnimals.size;
      const pregnantCount = Array.from(confirmedPregnantOn.values()).filter(
        (d) => d >= windowStart && d <= windowEnd,
      ).length;
      const rate =
        eligibleCount > 0
          ? Math.round((pregnantCount / eligibleCount) * 100)
          : 0;

      pregnancyRateByCycle.push({
        label: `Cycle ${c + 1}`,
        windowStart: windowStart.toISOString().slice(0, 10),
        windowEnd: windowEnd.toISOString().slice(0, 10),
        eligibleCount,
        pregnantCount,
        rate,
      });
    }
  }

  // ── Days Open ─────────────────────────────────────────────────────────────

  const daysOpen: DaysOpenRecord[] = [];
  for (const [animalId, birthDates] of birthsByAnimal.entries()) {
    const sorted = [...birthDates].sort(
      (a, b) => a.getTime() - b.getTime(),
    );
    const latestBirth = sorted[sorted.length - 1];
    const vwpEnd = addDays(latestBirth, voluntaryWaitingDays);

    const conceptionObs =
      [...reproObs]
        .filter(
          (o) =>
            o.animalId === animalId &&
            o.type === pregnancyScanObsType &&
            o.observedAt >= vwpEnd &&
            parseDetails(o.details).result === "pregnant",
        )
        .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())[0] ??
      null;

    const conceptionDate = conceptionObs?.observedAt ?? null;
    const daysOpenValue =
      conceptionDate !== null ? daysBetween(latestBirth, conceptionDate) : null;
    const isExtended = daysOpenValue === null || daysOpenValue > 90;

    daysOpen.push({
      animalId,
      birthDate: latestBirth,
      conceptionDate,
      daysOpen: daysOpenValue,
      isExtended,
    });
  }

  const confirmedDaysOpen = daysOpen
    .filter((d) => d.daysOpen !== null)
    .map((d) => d.daysOpen as number);
  const avgDaysOpen =
    confirmedDaysOpen.length > 0
      ? Math.round(
          confirmedDaysOpen.reduce((s, v) => s + v, 0) /
            confirmedDaysOpen.length,
        )
      : null;

  // ── Weaning Rate ──────────────────────────────────────────────────────────

  const animalsExposed = new Set(
    reproObs
      .filter((o) => o.type === inseminationObsType && o.animalId)
      .map((o) => o.animalId as string),
  ).size;
  const weaningRate =
    animalsExposed > 0
      ? Math.round((liveBirths12m / animalsExposed) * 100)
      : null;

  return {
    pregnancyRate,
    birthRate,
    avgBirthIntervalDays,
    upcomingBirths,
    inHeat7d,
    inseminations30d,
    birthsDue30d,
    scanCounts,
    conceptionRate,
    pregnancyRateByCycle,
    daysOpen,
    avgDaysOpen,
    weaningRate,
  };
}
