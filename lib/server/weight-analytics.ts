// lib/server/weight-analytics.ts
import type { PrismaClient } from "@prisma/client";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { parseWeighingMassKg } from "@/lib/domain/observations/weighing-mass";

// ADR-0005 Wave 2: per-animal ADG + herd-ADG trend are analytics
// roll-ups. crossSpecies() forwards args verbatim — the per-animalId /
// type predicates already bound these reads; behaviour is identical.

export interface WeightRecord {
  id: string;
  observedAt: Date;
  weightKg: number;
}

export interface ADGResult {
  latestWeight: number | null;
  /** ADG between last two readings (legacy, kept for backwards compat) */
  adg: number | null;
  adgTrend: "good" | "ok" | "poor" | null;
  /** ADG from first recorded weight to latest (most stable long-run indicator) */
  longRunAdg: number | null;
  longRunAdgTrend: "good" | "ok" | "poor" | null;
  /** ADG over the last 90 days (null if no weigh-in in that window) */
  rolling90Adg: number | null;
  rolling90AdgTrend: "good" | "ok" | "poor" | null;
  /** true if the best available ADG is below the poor-doer threshold (0.7 kg/day) */
  isPoorDoer: boolean;
  records: WeightRecord[];
}

/** Per-camp average ADG for a given period (for herd-level Grafieke chart) */
export interface HerdAdgPoint {
  campId: string;
  campName: string;
  /** ISO date string of the weigh date (YYYY-MM-DD) */
  weighDate: string;
  avgAdg: number;
}

export function calcAdgTrend(adg: number): "good" | "ok" | "poor" {
  if (adg > 0.9) return "good";
  if (adg >= 0.7) return "ok";
  return "poor";
}

export async function getAnimalWeightData(
  prisma: PrismaClient,
  animalId: string,
  poorDoerThreshold = 0.7,
): Promise<ADGResult> {
  const rawObs = await crossSpecies(prisma, "analytics-rollup").observation.findMany({
    where: { type: "weighing", animalId },
    orderBy: { observedAt: "asc" },
  });

  const records: WeightRecord[] = rawObs.flatMap((obs) => {
    const weightKg = parseWeighingMassKg(obs.details);
    if (weightKg === null) return [];
    return [
      {
        id: obs.id,
        observedAt: obs.observedAt,
        weightKg,
      },
    ];
  });

  if (records.length === 0) {
    return {
      latestWeight: null, adg: null, adgTrend: null,
      longRunAdg: null, longRunAdgTrend: null,
      rolling90Adg: null, rolling90AdgTrend: null,
      isPoorDoer: false, records: [],
    };
  }

  const latestWeight = records[records.length - 1].weightKg;

  // ── Legacy: last-interval ADG ────────────────────────────────────────────
  let adg: number | null = null;
  let adgTrend: "good" | "ok" | "poor" | null = null;
  if (records.length >= 2) {
    const prev = records[records.length - 2];
    const last = records[records.length - 1];
    const daysDiff = (last.observedAt.getTime() - prev.observedAt.getTime()) / 86_400_000;
    if (daysDiff > 0) {
      adg = (last.weightKg - prev.weightKg) / daysDiff;
      adgTrend = calcAdgTrend(adg);
    }
  }

  // ── Long-run ADG (first → last) ──────────────────────────────────────────
  let longRunAdg: number | null = null;
  let longRunAdgTrend: "good" | "ok" | "poor" | null = null;
  if (records.length >= 2) {
    const first = records[0];
    const last = records[records.length - 1];
    const days = (last.observedAt.getTime() - first.observedAt.getTime()) / 86_400_000;
    if (days > 0) {
      longRunAdg = (last.weightKg - first.weightKg) / days;
      longRunAdgTrend = calcAdgTrend(longRunAdg);
    }
  }

  // ── 90-day rolling ADG ───────────────────────────────────────────────────
  let rolling90Adg: number | null = null;
  let rolling90AdgTrend: "good" | "ok" | "poor" | null = null;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const last = records[records.length - 1];
  // Find earliest weigh-in within 90-day window
  const windowRecords = records.filter((r) => r.observedAt >= ninetyDaysAgo);
  if (windowRecords.length >= 2) {
    const first90 = windowRecords[0];
    const days = (last.observedAt.getTime() - first90.observedAt.getTime()) / 86_400_000;
    if (days > 0) {
      rolling90Adg = (last.weightKg - first90.weightKg) / days;
      rolling90AdgTrend = calcAdgTrend(rolling90Adg);
    }
  } else if (windowRecords.length === 1 && records.length >= 2) {
    // Latest weigh-in is in the window; use closest earlier reading as baseline
    const baselineIdx = records.findIndex((r) => r.id === windowRecords[0].id) - 1;
    if (baselineIdx >= 0) {
      const baseline = records[baselineIdx];
      const days = (last.observedAt.getTime() - baseline.observedAt.getTime()) / 86_400_000;
      if (days > 0) {
        rolling90Adg = (last.weightKg - baseline.weightKg) / days;
        rolling90AdgTrend = calcAdgTrend(rolling90Adg);
      }
    }
  }

  // ── Poor doer flag ────────────────────────────────────────────────────────
  // Use best available ADG signal: 90-day > long-run > last-interval
  const bestAdg = rolling90Adg ?? longRunAdg ?? adg;
  const isPoorDoer = bestAdg !== null && bestAdg < poorDoerThreshold;

  return {
    latestWeight, adg, adgTrend,
    longRunAdg, longRunAdgTrend,
    rolling90Adg, rolling90AdgTrend,
    isPoorDoer, records,
  };
}

/**
 * Compact weight summary for one animal in a list/table context. Carries just
 * the fields the catalogue Animals table renders (latest weight, the best
 * available ADG signal, the poor-doer flag, and the raw weight series so a
 * sparkline can plot the real trend). A row with no weighings yields
 * `latestWeight: null` / `adg: null` / `series: []` so the table can render an
 * honest "—".
 */
export interface AnimalWeightSummary {
  /** kg of the most recent weighing, or null when the animal was never weighed. */
  latestWeight: number | null;
  /** Best available ADG (90-day → long-run → last-interval), kg/day, or null. */
  adg: number | null;
  /** true when `adg` is below the configured poor-doer threshold. */
  isPoorDoer: boolean;
  /** Chronological weight readings (kg) for the inline sparkline. */
  series: number[];
}

/**
 * Batched per-animal weight summaries. Reads EVERY weighing observation for the
 * tenant in a single `findMany` (the same shape `getHerdAdgTrend` already uses)
 * and groups in-memory by `animalId` — so the Animals catalogue can show a real
 * WEIGHT / ADG / ADG-trend column for a 50-row page without one query per row.
 *
 * Returns a `Map<animalId, AnimalWeightSummary>`; animals with no weighing rows
 * are simply absent from the map (the caller renders "—" for those).
 */
export async function getAnimalWeightSummaries(
  prisma: PrismaClient,
  poorDoerThreshold = 0.7,
): Promise<Map<string, AnimalWeightSummary>> {
  const rawObs = await crossSpecies(prisma, "analytics-rollup").observation.findMany({
    where: { type: "weighing", animalId: { not: null } },
    select: { animalId: true, observedAt: true, details: true },
    orderBy: { observedAt: "asc" },
  });

  // Build per-animal chronological weight timelines.
  const byAnimal = new Map<string, WeightRecord[]>();
  for (const obs of rawObs) {
    if (!obs.animalId) continue;
    const weightKg = parseWeighingMassKg(obs.details);
    if (weightKg === null) continue;
    const existing = byAnimal.get(obs.animalId) ?? [];
    existing.push({ id: "", observedAt: obs.observedAt, weightKg });
    byAnimal.set(obs.animalId, existing);
  }

  const summaries = new Map<string, AnimalWeightSummary>();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);

  for (const [animalId, records] of byAnimal.entries()) {
    if (records.length === 0) continue;
    const latest = records[records.length - 1];
    const latestWeight = latest.weightKg;

    // Best available ADG signal: 90-day window → long-run → last interval. Same
    // precedence `getAnimalWeightData` uses for its poor-doer flag.
    let adg: number | null = null;
    const windowRecords = records.filter((r) => r.observedAt >= ninetyDaysAgo);
    if (windowRecords.length >= 2) {
      const first90 = windowRecords[0];
      const days = (latest.observedAt.getTime() - first90.observedAt.getTime()) / 86_400_000;
      if (days > 0) adg = (latestWeight - first90.weightKg) / days;
    }
    if (adg === null && records.length >= 2) {
      const first = records[0];
      const days = (latest.observedAt.getTime() - first.observedAt.getTime()) / 86_400_000;
      if (days > 0) adg = (latestWeight - first.weightKg) / days;
    }
    if (adg === null && records.length >= 2) {
      const prev = records[records.length - 2];
      const days = (latest.observedAt.getTime() - prev.observedAt.getTime()) / 86_400_000;
      if (days > 0) adg = (latestWeight - prev.weightKg) / days;
    }

    summaries.set(animalId, {
      latestWeight,
      adg,
      isPoorDoer: adg !== null && adg < poorDoerThreshold,
      series: records.map((r) => r.weightKg),
    });
  }

  return summaries;
}

/**
 * Returns per-camp average ADG points for the Grafieke herd ADG chart.
 * Groups all weighing observations by camp, computes ADG between consecutive
 * weigh dates, then averages across all animals weighed on the same date.
 */
export async function getHerdAdgTrend(
  prisma: PrismaClient,
  camps: { campId: string; campName: string }[],
  lookbackDays = 365,
): Promise<HerdAdgPoint[]> {
  const cutoff = new Date(Date.now() - lookbackDays * 86_400_000);
  const campMap = new Map(camps.map((c) => [c.campId, c.campName]));

  const rawObs = await crossSpecies(prisma, "analytics-rollup").observation.findMany({
    where: {
      type: "weighing",
      observedAt: { gte: cutoff },
      animalId: { not: null },
    },
    select: { animalId: true, campId: true, observedAt: true, details: true },
    orderBy: { observedAt: "asc" },
  });

  // Build per-animal weight timelines
  const byAnimal = new Map<string, { campId: string; date: Date; weightKg: number }[]>();
  for (const obs of rawObs) {
    if (!obs.animalId) continue;
    const weightKg = parseWeighingMassKg(obs.details);
    if (weightKg === null) continue;
    const existing = byAnimal.get(obs.animalId) ?? [];
    existing.push({ campId: obs.campId, date: obs.observedAt, weightKg });
    byAnimal.set(obs.animalId, existing);
  }

  // Collect (campId, date, adg) tuples from consecutive readings per animal
  const adgTuples: { campId: string; dateStr: string; adg: number }[] = [];
  for (const readings of byAnimal.values()) {
    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];
      const days = (curr.date.getTime() - prev.date.getTime()) / 86_400_000;
      if (days <= 0) continue;
      const adg = (curr.weightKg - prev.weightKg) / days;
      adgTuples.push({
        campId: curr.campId,
        dateStr: curr.date.toISOString().slice(0, 10),
        adg,
      });
    }
  }

  // Average ADG by camp + date
  const sumMap = new Map<string, { sum: number; count: number }>();
  for (const { campId, dateStr, adg } of adgTuples) {
    const key = `${campId}__${dateStr}`;
    const existing = sumMap.get(key) ?? { sum: 0, count: 0 };
    sumMap.set(key, { sum: existing.sum + adg, count: existing.count + 1 });
  }

  const result: HerdAdgPoint[] = [];
  for (const [key, { sum, count }] of sumMap.entries()) {
    const [campId, weighDate] = key.split("__");
    if (!campMap.has(campId)) continue;
    result.push({
      campId,
      campName: campMap.get(campId) ?? campId,
      weighDate,
      avgAdg: Math.round((sum / count) * 100) / 100,
    });
  }

  result.sort((a, b) => a.weighDate.localeCompare(b.weighDate));
  return result;
}
