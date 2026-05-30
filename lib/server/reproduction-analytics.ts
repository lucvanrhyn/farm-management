// lib/server/reproduction-analytics.ts
import type { PrismaClient } from "@prisma/client";
import { scoped } from "@/lib/server/species-scoped-prisma";

const GESTATION_DAYS = 285; // SA midpoint: Bonsmara/Brangus/Nguni 283–285d
const VOLUNTARY_WAITING_PERIOD_DAYS = 45; // VWP after calving before cow is eligible

export interface UpcomingCalving {
  animalId: string;
  campId: string;
  campName: string;
  expectedCalving: Date;
  daysAway: number;
  source: "scan" | "insemination";
}

/** Pregnancy rate per 21-day estrus cycle window */
export interface PregnancyRateCycle {
  /** Label for the cycle, e.g. "Cycle 1 (01 Oct – 21 Oct)" */
  label: string;
  /** ISO start date of the cycle window */
  windowStart: string;
  /** ISO end date of the cycle window */
  windowEnd: string;
  /** Number of eligible cows in this cycle */
  eligibleCount: number;
  /** Number confirmed pregnant in this cycle */
  pregnantCount: number;
  /** Rate as a percentage 0–100 */
  rate: number;
}

/** Days open for an individual cow */
export interface DaysOpenRecord {
  animalId: string;
  /** Date of most recent calving */
  calvingDate: Date;
  /** Date of confirmed conception (pregnancy scan date), or null if not yet confirmed */
  conceptionDate: Date | null;
  /** Days from calving to conception; null if conception not confirmed */
  daysOpen: number | null;
  /** true if daysOpen > 90 days or no conception recorded */
  isExtended: boolean;
}

export interface ReproStats {
  /**
   * Whether these stats are meaningful for the requested species (#356).
   *
   * This engine is the CATTLE reproduction surface: every KPI below is
   * derived from cattle-typed observations (`calving` / `insemination` /
   * `heat_detection`), a 285-day gestation, and SA cattle benchmarks.
   * Sheep have a separate, species-correct surface
   * (`/sheep/reproduction` → `sheepModule.getReproStats`, lambing/joining
   * semantics); game has no reproduction-event vocabulary at all.
   *
   * For a non-cattle `options.species` the engine short-circuits and
   * returns an all-empty payload with `available: false` so callers render
   * an explicit "not available for this species" state — NEVER cattle
   * numbers under a sheep/game label. Defaults to `true` (the cattle path,
   * and any caller that omits the field) so existing consumers are
   * unaffected.
   */
  available?: boolean;
  pregnancyRate: number | null;          // pregnant scans / eligible females × 100
  calvingRate: number | null;            // live calvings / inseminations (12m) × 100
  avgCalvingIntervalDays: number | null; // avg days between consecutive calvings per animal
  upcomingCalvings: UpcomingCalving[];   // sorted by daysAway asc; next 90d + up to 7d overdue
  inHeat7d: number;
  inseminations30d: number;
  calvingsDue30d: number;
  scanCounts: { pregnant: number; empty: number; uncertain: number };
  conceptionRate: number | null;         // pregnant / (pregnant + empty) × 100
  /** Per-cycle 21-day pregnancy rates for the current breeding season (last 6 cycles) */
  pregnancyRateByCycle: PregnancyRateCycle[];
  /** Per-animal days open for animals that calved in the last 18 months */
  daysOpen: DaysOpenRecord[];
  /** Average days open across animals with confirmed conception */
  avgDaysOpen: number | null;
  /** Weaning rate: calves weaned ÷ cows exposed × 100 */
  weaningRate: number | null;
}

export interface CalvingUrgencyTiers {
  /** Overdue: daysAway < 0 */
  overdue: UpcomingCalving[];
  /** Due within 0–7 days */
  due7d: UpcomingCalving[];
  /** Due within 8 to alertDays days */
  due14d: UpcomingCalving[];
  /** Due within alertDays+1 to 90 days */
  upcoming: UpcomingCalving[];
}

/**
 * Buckets a list of upcoming calvings into urgency tiers.
 * @param calvings  - sorted list of upcoming calvings (from getReproStats)
 * @param alertDays - configurable alert window; calvings within this window are
 *                    split into due7d (0–7d) and due14d (8–alertDays). Defaults to 14.
 */
export function getCalvingUrgencyTiers(
  calvings: UpcomingCalving[],
  alertDays = 14,
): CalvingUrgencyTiers {
  const overdue: UpcomingCalving[] = [];
  const due7d: UpcomingCalving[] = [];
  const due14d: UpcomingCalving[] = [];
  const upcoming: UpcomingCalving[] = [];

  for (const c of calvings) {
    if (c.daysAway < 0) {
      overdue.push(c);
    } else if (c.daysAway <= 7) {
      due7d.push(c);
    } else if (c.daysAway <= alertDays) {
      due14d.push(c);
    } else {
      upcoming.push(c);
    }
  }

  return { overdue, due7d, due14d, upcoming };
}

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

/**
 * The gated payload returned when {@link getReproStats} is asked for a
 * non-cattle species (#356). Every metric is empty and `available` is
 * `false`, so a caller renders an explicit "not available for this species"
 * state instead of cattle-derived numbers. No DB query runs to produce it.
 */
const CATTLE_ONLY_REPRO_STATS: ReproStats = {
  available: false,
  pregnancyRate: null,
  calvingRate: null,
  avgCalvingIntervalDays: null,
  upcomingCalvings: [],
  inHeat7d: 0,
  inseminations30d: 0,
  calvingsDue30d: 0,
  scanCounts: { pregnant: 0, empty: 0, uncertain: 0 },
  conceptionRate: null,
  pregnancyRateByCycle: [],
  daysOpen: [],
  avgDaysOpen: null,
  weaningRate: null,
};

export async function getReproStats(
  prisma: PrismaClient,
  options?: { species?: string },
): Promise<ReproStats> {
  // #356 — This is the CATTLE reproduction engine: every KPI below is
  // derived from cattle-typed observations (`calving` / `insemination` /
  // `heat_detection`), a 285-day gestation, and SA cattle benchmarks. Sheep
  // have a separate, species-correct surface (`/sheep/reproduction` →
  // `sheepModule.getReproStats`); game has no reproduction-event vocabulary.
  //
  // When a caller (the /admin/reproduction page, the dashboard fetcher)
  // passes a NON-cattle mode, we must NOT run a cattle-scoped query and show
  // the numbers under a "Lambing"/"Fawning" label. Short-circuit to the
  // gated empty payload — `available: false` — so the caller renders an
  // explicit "not available for this species" state instead. An omitted /
  // "cattle" species (export call-sites, cattle mode) falls through to the
  // real cattle path below, preserving existing behaviour byte-for-byte.
  if (options?.species != null && options.species !== "cattle") {
    return CATTLE_ONLY_REPRO_STATS;
  }

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

  // Reproduction analytics are intrinsically cattle-grounded (285d
  // gestation, calving/scan/insemination cattle semantics; the sheep
  // reproduction surface is a separate module). ADR-0005 Wave 2 routes
  // these reads through scoped(prisma, "cattle"), which injects
  // { species: "cattle" }. We deliberately scope to cattle (not
  // `options.species`) here: non-cattle modes are gated out at the top of
  // this function (#356), so reaching this line means species is cattle (or
  // the caller omitted it — export call-sites, which produce cattle exports).
  const db = scoped(prisma, "cattle");

  const [reproObs, calvingObs, allCamps] = await Promise.all([
    db.observation.findMany({
      where: {
        type: { in: ["heat_detection", "insemination", "pregnancy_scan"] },
        observedAt: { gte: twelveMonthsAgo },
      },
      orderBy: { observedAt: "desc" },
      select: selectFields,
    }),
    db.observation.findMany({
      where: {
        type: "calving",
        observedAt: { gte: eighteenMonthsAgo },
      },
      orderBy: { observedAt: "asc" },
      select: selectFields,
    }),
    db.camp.findMany({ select: { campId: true, campName: true } }),
  ]);

  type ObsRow = (typeof reproObs)[0];

  const campMap = new Map(allCamps.map((c) => [c.campId, c.campName]));

  // ── Activity KPIs ────────────────────────────────────────────────────────

  const inHeat7d = new Set(
    reproObs
      .filter((o) => o.type === "heat_detection" && o.observedAt >= sevenDaysAgo && o.animalId)
      .map((o) => o.animalId as string)
  ).size;

  const inseminations30d = reproObs.filter(
    (o) => o.type === "insemination" && o.observedAt >= thirtyDaysAgo
  ).length;

  // ── Scan results (latest scan per animal) ───────────────────────────────

  const latestScanByAnimal = new Map<string, ObsRow>();
  for (const obs of reproObs.filter((o) => o.type === "pregnancy_scan" && o.animalId)) {
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
    reproObs.filter((o) => o.animalId).map((o) => o.animalId as string)
  ).size;
  const pregnancyRate =
    femalesWithReproEvents > 0
      ? Math.round((scanCounts.pregnant / femalesWithReproEvents) * 100)
      : null;

  // ── Calving Rate ──────────────────────────────────────────────────────────
  const calvingObs12m = calvingObs.filter((o) => o.observedAt >= twelveMonthsAgo);
  const totalInseminations12m = reproObs.filter((o) => o.type === "insemination").length;
  const liveCalvings12m = calvingObs12m.filter(
    (o) => parseDetails(o.details).calf_status === "live"
  ).length;
  const calvingRate =
    totalInseminations12m > 0
      ? Math.round((liveCalvings12m / totalInseminations12m) * 100)
      : null;

  // ── Avg Calving Interval ──────────────────────────────────────────────────
  const calvingsByAnimal = new Map<string, Date[]>();
  for (const obs of calvingObs) {
    if (!obs.animalId) continue;
    const existing = calvingsByAnimal.get(obs.animalId) ?? [];
    existing.push(obs.observedAt);
    calvingsByAnimal.set(obs.animalId, existing);
  }

  const intervals: number[] = [];
  for (const dates of calvingsByAnimal.values()) {
    if (dates.length < 2) continue;
    dates.sort((a, b) => a.getTime() - b.getTime());
    for (let i = 1; i < dates.length; i++) {
      intervals.push((dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000);
    }
  }
  const avgCalvingIntervalDays =
    intervals.length > 0
      ? Math.round(intervals.reduce((sum, v) => sum + v, 0) / intervals.length)
      : null;

  // ── Upcoming Calvings ─────────────────────────────────────────────────────
  const latestInsemByAnimal = new Map<string, ObsRow>();
  for (const obs of reproObs.filter((o) => o.type === "insemination" && o.animalId)) {
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

  const upcomingCalvings: UpcomingCalving[] = [];
  for (const animalId of candidateIds) {
    const scanObs = latestScanByAnimal.get(animalId);
    const insemObs = latestInsemByAnimal.get(animalId);
    const useScan = scanObs != null && parseDetails(scanObs.details).result === "pregnant";
    const baseObs = useScan ? scanObs! : insemObs;
    if (!baseObs) continue;

    const expectedCalving = addDays(baseObs.observedAt, GESTATION_DAYS);
    const daysAway = daysFromNow(expectedCalving);
    if (daysAway < -7 || daysAway > 90) continue;

    upcomingCalvings.push({
      animalId,
      campId: baseObs.campId,
      campName: campMap.get(baseObs.campId) ?? baseObs.campId,
      expectedCalving,
      daysAway,
      source: useScan ? "scan" : "insemination",
    });
  }
  upcomingCalvings.sort((a, b) => a.daysAway - b.daysAway);

  const calvingsDue30d = upcomingCalvings.filter(
    (c) => c.daysAway >= 0 && c.daysAway <= 30
  ).length;

  // ── 21-day Pregnancy Rate by Cycle ───────────────────────────────────────
  // Derive breeding season start: earliest insemination in the 12m window
  const inseminations = reproObs
    .filter((o) => o.type === "insemination")
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

  const pregnancyRateByCycle: PregnancyRateCycle[] = [];
  if (inseminations.length > 0) {
    const seasonStart = inseminations[0].observedAt;
    const NUM_CYCLES = 6;

    // All animals that had ≥1 repro event in the 12m window are the eligible pool
    const eligibleAnimals = new Set(
      reproObs.filter((o) => o.animalId).map((o) => o.animalId as string)
    );

    // Per-animal: latest confirmed-pregnant scan date
    const confirmedPregnantOn = new Map<string, Date>();
    for (const [id, obs] of latestScanByAnimal.entries()) {
      if (parseDetails(obs.details).result === "pregnant") {
        confirmedPregnantOn.set(id, obs.observedAt);
      }
    }

    for (let c = 0; c < NUM_CYCLES; c++) {
      const windowStart = addDays(seasonStart, c * 21);
      const windowEnd = addDays(seasonStart, (c + 1) * 21 - 1);
      if (windowStart > new Date()) break; // don't show future cycles

      const eligibleCount = eligibleAnimals.size;
      const pregnantCount = Array.from(confirmedPregnantOn.values()).filter(
        (d) => d >= windowStart && d <= windowEnd
      ).length;
      const rate = eligibleCount > 0 ? Math.round((pregnantCount / eligibleCount) * 100) : 0;

      const fmtDate = (d: Date) =>
        d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });

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
  // For each cow that calved in the last 18 months, find next confirmed conception
  const daysOpen: DaysOpenRecord[] = [];
  for (const [animalId, calvingDates] of calvingsByAnimal.entries()) {
    calvingDates.sort((a, b) => a.getTime() - b.getTime());
    const latestCalving = calvingDates[calvingDates.length - 1];

    // Earliest VWP end date (cow is eligible for conception only after VWP)
    const vwpEnd = addDays(latestCalving, VOLUNTARY_WAITING_PERIOD_DAYS);

    // Find the first pregnancy scan confirming pregnant after VWP
    const conceptionObs = Array.from(
      reproObs.filter(
        (o) =>
          o.animalId === animalId &&
          o.type === "pregnancy_scan" &&
          o.observedAt >= vwpEnd &&
          parseDetails(o.details).result === "pregnant"
      )
    ).sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())[0] ?? null;

    const conceptionDate = conceptionObs?.observedAt ?? null;
    const daysOpenValue = conceptionDate !== null
      ? daysBetween(latestCalving, conceptionDate)
      : null;
    const isExtended = daysOpenValue === null || daysOpenValue > 90;

    daysOpen.push({ animalId, calvingDate: latestCalving, conceptionDate, daysOpen: daysOpenValue, isExtended });
  }

  const confirmedDaysOpen = daysOpen.filter((d) => d.daysOpen !== null).map((d) => d.daysOpen as number);
  const avgDaysOpen =
    confirmedDaysOpen.length > 0
      ? Math.round(confirmedDaysOpen.reduce((s, v) => s + v, 0) / confirmedDaysOpen.length)
      : null;

  // ── Weaning Rate ──────────────────────────────────────────────────────────
  // Weaned = calf that transitioned from "Calf" category, or was recorded in calving
  // events as a live calf. Exposed = cows with ≥1 insemination in the 12m window.
  // Simplified: live calvings / cows inseminated (12m) × 100 (proxy until weaning obs type exists)
  const cowsExposed = new Set(
    reproObs
      .filter((o) => o.type === "insemination" && o.animalId)
      .map((o) => o.animalId as string)
  ).size;
  const calvesWeaned = liveCalvings12m; // proxy: live calvings ≈ calves that can be weaned
  const weaningRate =
    cowsExposed > 0
      ? Math.round((calvesWeaned / cowsExposed) * 100)
      : null;

  return {
    available: true,
    pregnancyRate,
    calvingRate,
    avgCalvingIntervalDays,
    upcomingCalvings,
    inHeat7d,
    inseminations30d,
    calvingsDue30d,
    scanCounts,
    conceptionRate,
    pregnancyRateByCycle,
    daysOpen,
    avgDaysOpen,
    weaningRate,
  };
}
