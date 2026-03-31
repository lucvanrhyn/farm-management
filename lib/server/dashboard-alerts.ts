// lib/server/dashboard-alerts.ts
import type { PrismaClient } from "@prisma/client";
import type { ReproStats } from "@/lib/server/reproduction-analytics";
import { getReproStats } from "@/lib/server/reproduction-analytics";
import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";
import type { LiveCampStatus } from "@/lib/server/camp-status";
import { getLatestCampConditions } from "@/lib/server/camp-status";

export interface DashboardAlert {
  id: string;
  severity: "red" | "amber";
  icon: string; // lucide icon name as string
  message: string;
  count: number;
  href: string;
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
 */
export interface PreFetchedAlertData {
  reproStats?: ReproStats;
  campConditions?: Map<string, LiveCampStatus>;
}

export async function getDashboardAlerts(
  prisma: PrismaClient,
  farmSlug: string,
  thresholds: AlertThresholds,
  preFetched: PreFetchedAlertData = {},
): Promise<DashboardAlerts> {
  const {
    adgPoorDoerThreshold,
    calvingAlertDays,
    daysOpenLimit,
    staleCampInspectionHours,
  } = thresholds;

  const now = new Date();

  // Use pre-fetched data when available, fetch only what's missing
  const [reproStats, withdrawalAnimals, campConditions, totalCamps] = await Promise.all([
    preFetched.reproStats ?? getReproStats(prisma),
    getAnimalsInWithdrawal(prisma),
    preFetched.campConditions ?? getLatestCampConditions(prisma),
    prisma.camp.count(),
  ]);

  // ── Poor doers: query weighing observations, compute long-run ADG per animal ──
  const weighingObs = await prisma.observation.findMany({
    where: { type: "weighing", animalId: { not: null } },
    select: { animalId: true, observedAt: true, details: true },
    orderBy: { observedAt: "asc" },
  });

  // Group by animalId, compute best ADG
  const byAnimal = new Map<string, { date: Date; weightKg: number }[]>();
  for (const obs of weighingObs) {
    if (!obs.animalId) continue;
    let details: { weight_kg?: number } = {};
    try { details = JSON.parse(obs.details) as { weight_kg?: number }; } catch { continue; }
    if (typeof details.weight_kg !== "number") continue;
    const existing = byAnimal.get(obs.animalId) ?? [];
    existing.push({ date: obs.observedAt, weightKg: details.weight_kg });
    byAnimal.set(obs.animalId, existing);
  }

  let poorDoerCount = 0;
  for (const readings of byAnimal.values()) {
    if (readings.length < 2) continue;
    const first = readings[0];
    const last = readings[readings.length - 1];
    const days = (last.date.getTime() - first.date.getTime()) / 86_400_000;
    if (days <= 0) continue;
    const longRunAdg = (last.weightKg - first.weightKg) / days;
    if (longRunAdg < adgPoorDoerThreshold) poorDoerCount++;
  }

  // ── Stale camp inspections ─────────────────────────────────────────────────
  const staleThresholdMs = staleCampInspectionHours * 60 * 60 * 1000;
  let staleCampCount = 0;
  // Camps with no inspection record count as stale
  const uninspectedCamps = totalCamps - campConditions.size;
  staleCampCount += uninspectedCamps;
  // Camps with old inspection count as stale
  for (const status of campConditions.values()) {
    const inspectedAt = new Date(status.last_inspected_at);
    const ageMs = now.getTime() - inspectedAt.getTime();
    if (ageMs > staleThresholdMs) staleCampCount++;
  }

  // ── Camp grazing ───────────────────────────────────────────────────────────
  let poorGrazingCount = 0;
  for (const status of campConditions.values()) {
    if (status.grazing_quality === "Poor" || status.grazing_quality === "Overgrazed") {
      poorGrazingCount++;
    }
  }

  // ── Calving tiers ─────────────────────────────────────────────────────────
  const overdueCounts = reproStats.upcomingCalvings.filter(c => c.daysAway < 0).length;
  const due7dCount = reproStats.upcomingCalvings.filter(c => c.daysAway >= 0 && c.daysAway <= 7).length;
  const due14dCount = reproStats.upcomingCalvings.filter(c => c.daysAway > 7 && c.daysAway <= calvingAlertDays).length;

  // ── Open cows above limit ──────────────────────────────────────────────────
  const openCowsOverLimit = reproStats.daysOpen.filter(d =>
    (d.daysOpen !== null && d.daysOpen > daysOpenLimit) ||
    (d.daysOpen === null && d.isExtended)
  ).length;

  // ── Build alert arrays ────────────────────────────────────────────────────
  const red: DashboardAlert[] = [];
  const amber: DashboardAlert[] = [];

  // Red: overdue calvings
  if (overdueCounts > 0) {
    red.push({
      id: "overdue-calvings",
      severity: "red",
      icon: "Baby",
      message: overdueCounts === 1
        ? "1 animal overdue to calve"
        : `${overdueCounts} animals overdue to calve`,
      count: overdueCounts,
      href: `/${farmSlug}/admin/reproduction`,
    });
  }

  // Red: animals in withdrawal
  if (withdrawalAnimals.length > 0) {
    red.push({
      id: "in-withdrawal",
      severity: "red",
      icon: "FlaskConical",
      message: withdrawalAnimals.length === 1
        ? "1 animal in withdrawal period"
        : `${withdrawalAnimals.length} animals in withdrawal period`,
      count: withdrawalAnimals.length,
      href: `/${farmSlug}/admin/animals`,
    });
  }

  // Red: poor or overgrazed camps
  if (poorGrazingCount > 0) {
    red.push({
      id: "poor-grazing",
      severity: "red",
      icon: "Tent",
      message: poorGrazingCount === 1
        ? "1 camp with poor or overgrazed pasture"
        : `${poorGrazingCount} camps with poor or overgrazed pasture`,
      count: poorGrazingCount,
      href: `/${farmSlug}/admin/performance`,
    });
  }

  // Amber: calvings due within 7 days
  if (due7dCount > 0) {
    amber.push({
      id: "calvings-due-7d",
      severity: "amber",
      icon: "Baby",
      message: due7dCount === 1
        ? "1 animal due to calve within 7 days"
        : `${due7dCount} animals due to calve within 7 days`,
      count: due7dCount,
      href: `/${farmSlug}/admin/reproduction`,
    });
  }

  // Amber: calvings due 8–14 days
  if (due14dCount > 0 && calvingAlertDays > 7) {
    amber.push({
      id: "calvings-due-14d",
      severity: "amber",
      icon: "Baby",
      message: due14dCount === 1
        ? `1 animal due to calve within ${calvingAlertDays} days`
        : `${due14dCount} animals due to calve within ${calvingAlertDays} days`,
      count: due14dCount,
      href: `/${farmSlug}/admin/reproduction`,
    });
  }

  // Amber: open cows over limit
  if (openCowsOverLimit > 0) {
    amber.push({
      id: "open-cows",
      severity: "amber",
      icon: "Calendar",
      message: openCowsOverLimit === 1
        ? `1 cow open beyond ${daysOpenLimit} days`
        : `${openCowsOverLimit} cows open beyond ${daysOpenLimit} days`,
      count: openCowsOverLimit,
      href: `/${farmSlug}/admin/reproduction`,
    });
  }

  // Amber: poor doers
  if (poorDoerCount > 0) {
    amber.push({
      id: "poor-doers",
      severity: "amber",
      icon: "TrendingDown",
      message: poorDoerCount === 1
        ? `1 animal with low ADG (below ${adgPoorDoerThreshold} kg/day)`
        : `${poorDoerCount} animals with low ADG (below ${adgPoorDoerThreshold} kg/day)`,
      count: poorDoerCount,
      href: `/${farmSlug}/admin/animals`,
    });
  }

  // Amber: stale camp inspections
  if (staleCampCount > 0) {
    amber.push({
      id: "stale-inspections",
      severity: "amber",
      icon: "ClipboardCheck",
      message: staleCampCount === 1
        ? `1 camp not inspected within ${staleCampInspectionHours}h`
        : `${staleCampCount} camps not inspected within ${staleCampInspectionHours}h`,
      count: staleCampCount,
      href: `/${farmSlug}/admin/observations`,
    });
  }

  return {
    red,
    amber,
    totalCount: red.length + amber.length,
  };
}
