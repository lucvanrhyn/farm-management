// lib/server/reproduction-analytics.ts
import type { PrismaClient } from "@prisma/client";

const GESTATION_DAYS = 285; // SA midpoint: Bonsmara/Brangus/Nguni 283–285d

export interface UpcomingCalving {
  animalId: string;
  campId: string;
  campName: string;
  expectedCalving: Date;
  daysAway: number;
  source: "scan" | "insemination";
}

export interface ReproStats {
  pregnancyRate: number | null;          // pregnant scans / eligible females × 100
  calvingRate: number | null;            // live calvings / inseminations (12m) × 100
  avgCalvingIntervalDays: number | null; // avg days between consecutive calvings per animal
  upcomingCalvings: UpcomingCalving[];   // sorted by daysAway asc; next 90d + up to 7d overdue
  inHeat7d: number;
  inseminations30d: number;
  calvingsDue30d: number;
  scanCounts: { pregnant: number; empty: number; uncertain: number };
  conceptionRate: number | null;         // pregnant / (pregnant + empty) × 100
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function daysFromNow(date: Date): number {
  return Math.round((date.getTime() - Date.now()) / 86_400_000);
}

function parseDetails(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function getReproStats(prisma: PrismaClient): Promise<ReproStats> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
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

  const [reproObs, calvingObs, allCamps] = await Promise.all([
    prisma.observation.findMany({
      where: {
        type: { in: ["heat_detection", "insemination", "pregnancy_scan"] },
        observedAt: { gte: twelveMonthsAgo },
      },
      orderBy: { observedAt: "desc" },
      select: selectFields,
    }),
    prisma.observation.findMany({
      where: {
        type: "calving",
        observedAt: { gte: twelveMonthsAgo },
      },
      orderBy: { observedAt: "asc" },
      select: selectFields,
    }),
    prisma.camp.findMany({ select: { campId: true, campName: true } }),
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

  // ── Pregnancy Rate ────────────────────────────────────────────────────────
  // pregnant scans ÷ all females with ≥1 repro event in rolling 12m window × 100
  const femalesWithReproEvents = new Set(
    reproObs.filter((o) => o.animalId).map((o) => o.animalId as string)
  ).size;
  const pregnancyRate =
    femalesWithReproEvents > 0
      ? Math.round((scanCounts.pregnant / femalesWithReproEvents) * 100)
      : null;

  // ── Calving Rate ──────────────────────────────────────────────────────────
  // live calvings ÷ total inseminations (12m) × 100
  const totalInseminations12m = reproObs.filter((o) => o.type === "insemination").length;
  const liveCalvings12m = calvingObs.filter(
    (o) => parseDetails(o.details).calf_status === "live"
  ).length;
  const calvingRate =
    totalInseminations12m > 0
      ? Math.round((liveCalvings12m / totalInseminations12m) * 100)
      : null;

  // ── Avg Calving Interval ──────────────────────────────────────────────────
  // avg(calving_n+1 − calving_n) per animal — only animals with ≥2 calvings
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
  // Prefer latest pregnancy_scan (confirmed pregnant) + 285d as base date.
  // Fallback: latest insemination + 285d.
  // Window: -7d (overdue) to +90d (upcoming).
  const latestInsemByAnimal = new Map<string, ObsRow>();
  for (const obs of reproObs.filter((o) => o.type === "insemination" && o.animalId)) {
    if (!latestInsemByAnimal.has(obs.animalId!)) {
      latestInsemByAnimal.set(obs.animalId!, obs);
    }
  }

  // Candidate animal IDs: confirmed-pregnant scans + all inseminations
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

  return {
    pregnancyRate,
    calvingRate,
    avgCalvingIntervalDays,
    upcomingCalvings,
    inHeat7d,
    inseminations30d,
    calvingsDue30d,
    scanCounts,
    conceptionRate,
  };
}
