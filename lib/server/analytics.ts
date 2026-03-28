import { type PrismaClient } from "@prisma/client";

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthsAgo(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

function toMonthString(date: Date): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

const QUALITY_SCORE: Record<string, number> = {
  Good: 4,
  Fair: 3,
  Poor: 2,
  Overgrazed: 1,
};

// ── Camp Condition Trend ──────────────────────────────────────────────────────

export interface ConditionTrendPoint {
  date: string;
  avgScore: number;
  count: number;
}

export async function getCampConditionTrend(prisma: PrismaClient, days = 30): Promise<ConditionTrendPoint[]> {
  const rows = await prisma.observation.findMany({
    where: { type: "camp_condition", observedAt: { gte: daysAgo(days) } },
    select: { observedAt: true, details: true },
    orderBy: { observedAt: "asc" },
  });

  const byDate = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    let details: Record<string, string> = {};
    try { details = JSON.parse(row.details); } catch { /* skip */ }
    const score = QUALITY_SCORE[details.grazing] ?? QUALITY_SCORE[details.grazing_quality] ?? 3;
    const key = toDateString(new Date(row.observedAt));
    const existing = byDate.get(key) ?? { total: 0, count: 0 };
    byDate.set(key, { total: existing.total + score, count: existing.count + 1 });
  }

  return Array.from(byDate.entries()).map(([date, { total, count }]) => ({
    date,
    avgScore: Math.round((total / count) * 10) / 10,
    count,
  }));
}

// ── Health Issues by Camp ─────────────────────────────────────────────────────

export interface HealthByCamp {
  campId: string;
  count: number;
}

export async function getHealthIssuesByCamp(prisma: PrismaClient, days = 30): Promise<HealthByCamp[]> {
  const rows = await prisma.observation.groupBy({
    by: ["campId"],
    where: { type: "health_issue", observedAt: { gte: daysAgo(days) } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return rows.map((r) => ({ campId: r.campId, count: r._count.id }));
}

// ── Headcount by Camp ─────────────────────────────────────────────────────────

export interface HeadcountByCamp {
  campId: string;
  category: string;
  count: number;
}

export async function getHeadcountByCamp(prisma: PrismaClient): Promise<HeadcountByCamp[]> {
  const rows = await prisma.animal.groupBy({
    by: ["currentCamp", "category"],
    where: { status: "Active" },
    _count: { id: true },
  });
  return rows.map((r) => ({
    campId: r.currentCamp ?? "Onbekend",
    category: r.category,
    count: r._count.id,
  }));
}

// ── Inspection Heatmap ────────────────────────────────────────────────────────

export interface HeatmapCell {
  campId: string;
  date: string;
  count: number;
}

export async function getInspectionHeatmap(prisma: PrismaClient, days = 30): Promise<HeatmapCell[]> {
  const rows = await prisma.observation.findMany({
    where: {
      type: { in: ["camp_check", "camp_condition"] },
      observedAt: { gte: daysAgo(days) },
    },
    select: { campId: true, observedAt: true },
  });

  const byKey = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.campId}__${toDateString(new Date(row.observedAt))}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }

  return Array.from(byKey.entries()).map(([key, count]) => {
    const [campId, date] = key.split("__");
    return { campId, date, count };
  });
}

// ── Animal Movement Flow ──────────────────────────────────────────────────────

export interface MovementRecord {
  id: string;
  date: string;
  animalId: string | null;
  fromCamp: string;
  toCamp: string;
  loggedBy: string | null;
}

export async function getAnimalMovements(prisma: PrismaClient, days = 30): Promise<MovementRecord[]> {
  const rows = await prisma.observation.findMany({
    where: { type: "animal_movement", observedAt: { gte: daysAgo(days) } },
    orderBy: { observedAt: "desc" },
    take: 100,
  });

  return rows.map((row) => {
    let details: Record<string, string> = {};
    try { details = JSON.parse(row.details); } catch { /* skip */ }
    return {
      id: row.id,
      date: toDateString(new Date(row.observedAt)),
      animalId: row.animalId,
      fromCamp: details.from_camp ?? details.from ?? "—",
      toCamp: details.to_camp ?? details.to ?? "—",
      loggedBy: row.loggedBy,
    };
  });
}

// ── Calving Trend ─────────────────────────────────────────────────────────────

export interface CalvingPoint {
  month: string;
  count: number;
}

export async function getCalvingTrend(prisma: PrismaClient, months = 12): Promise<CalvingPoint[]> {
  const rows = await prisma.observation.findMany({
    where: { type: "reproduction", observedAt: { gte: monthsAgo(months) } },
    select: { observedAt: true, details: true },
    orderBy: { observedAt: "asc" },
  });

  const byMonth = new Map<string, number>();
  for (const row of rows) {
    let details: Record<string, string> = {};
    try { details = JSON.parse(row.details); } catch { /* skip */ }
    const event = (details.event ?? "").toLowerCase();
    if (!event.includes("calv")) continue;
    const key = toMonthString(new Date(row.observedAt));
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }

  return Array.from(byMonth.entries()).map(([month, count]) => ({ month, count }));
}

// ── Deaths & Sales Over Time ──────────────────────────────────────────────────

export interface AttritionPoint {
  month: string;
  deaths: number;
  sales: number;
}

export async function getDeathsAndSales(prisma: PrismaClient, months = 12): Promise<AttritionPoint[]> {
  const deathObs = await prisma.observation.findMany({
    where: { type: "death", observedAt: { gte: monthsAgo(months) } },
    select: { observedAt: true },
  });

  const soldAnimals = await prisma.animal.findMany({
    where: { status: "Sold" },
    select: { dateAdded: true },
  });

  const byMonth = new Map<string, { deaths: number; sales: number }>();
  const ensure = (key: string) => {
    if (!byMonth.has(key)) byMonth.set(key, { deaths: 0, sales: 0 });
    return byMonth.get(key)!;
  };

  const cutoff = monthsAgo(months);
  for (const obs of deathObs) {
    const key = toMonthString(new Date(obs.observedAt));
    ensure(key).deaths += 1;
  }
  for (const animal of soldAnimals) {
    if (!animal.dateAdded || new Date(animal.dateAdded) < cutoff) continue;
    const key = toMonthString(new Date(animal.dateAdded));
    ensure(key).sales += 1;
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { deaths, sales }]) => ({ month, deaths, sales }));
}

// ── Days Grazing Remaining ────────────────────────────────────────────────────

export const LSU_EQUIVALENT: Record<string, number> = {
  Cow: 1.0,
  Bull: 1.5,
  Heifer: 0.75,
  Calf: 0.25,
  Ox: 1.0,
};

/**
 * Calculate days of grazing remaining in a camp.
 *
 * Formula (SA standard):
 *   Effective FOO = kgDmPerHa × useFactor × sizeHectares
 *   LSU           = Σ(count × LSU_EQUIVALENT[category])
 *   Days          = Effective FOO ÷ (LSU × 10 kg DM/LSU/day)
 *
 * Returns null when LSU = 0, no size, or no cover reading.
 */
export function calcDaysGrazingRemaining(
  kgDmPerHa: number,
  useFactor: number,
  sizeHectares: number,
  animalsByCategory: Array<{ category: string; count: number }>
): number | null {
  if (sizeHectares <= 0 || kgDmPerHa <= 0) return null;
  const lsu = animalsByCategory.reduce(
    (sum, { category, count }) => sum + count * (LSU_EQUIVALENT[category] ?? 1.0),
    0
  );
  if (lsu <= 0) return null;
  const effectiveFoo = kgDmPerHa * useFactor * sizeHectares;
  return effectiveFoo / (lsu * 10);
}

// ── Pasture Growth Rate ───────────────────────────────────────────────────────

export interface GrowthRateResult {
  growthRateKgPerDay: number | null;   // null if <2 readings
  projectedRecoveryDays: number | null;
  currentKgDmPerHa: number | null;
  readingCount: number;
}

/**
 * Calculate pasture growth rate between the last two cover readings for a camp.
 *
 * Formula:
 *   Growth Rate (kg DM/ha/day) = (current_kgDmPerHa − previous_kgDmPerHa) ÷ days_between
 *   Projected recovery days    = (1500 − current_kgDmPerHa) ÷ growth_rate  (if rate > 0)
 *
 * Growth rate can be negative when grazing exceeds growth.
 * Recovery target is "Medium" cover at 1500 kg DM/ha.
 */
export async function calcPastureGrowthRate(
  prisma: PrismaClient,
  campId: string
): Promise<GrowthRateResult> {
  const readings = await prisma.campCoverReading.findMany({
    where: { campId },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, kgDmPerHa: true },
  });

  if (readings.length < 2) {
    return {
      growthRateKgPerDay: null,
      projectedRecoveryDays: null,
      currentKgDmPerHa: readings.length === 1 ? readings[0].kgDmPerHa : null,
      readingCount: readings.length,
    };
  }

  const prev = readings[readings.length - 2];
  const curr = readings[readings.length - 1];

  const prevDate = new Date(prev.recordedAt);
  const currDate = new Date(curr.recordedAt);
  const daysBetween = Math.max(
    1,
    Math.round((currDate.getTime() - prevDate.getTime()) / 86_400_000)
  );

  const growthRateKgPerDay = (curr.kgDmPerHa - prev.kgDmPerHa) / daysBetween;

  const RECOVERY_TARGET_KG_DM_PER_HA = 1500;
  const projectedRecoveryDays =
    growthRateKgPerDay > 0 && curr.kgDmPerHa < RECOVERY_TARGET_KG_DM_PER_HA
      ? Math.ceil((RECOVERY_TARGET_KG_DM_PER_HA - curr.kgDmPerHa) / growthRateKgPerDay)
      : null;

  return {
    growthRateKgPerDay: Math.round(growthRateKgPerDay * 10) / 10,
    projectedRecoveryDays,
    currentKgDmPerHa: curr.kgDmPerHa,
    readingCount: readings.length,
  };
}

// ── Treatment Withdrawal Tracker ──────────────────────────────────────────────

export interface WithdrawalRecord {
  id: string;
  animalId: string | null;
  campId: string;
  drug: string;
  daysRemaining: number;
  observedAt: string;
}

export async function getWithdrawalTracker(prisma: PrismaClient): Promise<WithdrawalRecord[]> {
  const rows = await prisma.observation.findMany({
    where: { type: "treatment" },
    orderBy: { observedAt: "desc" },
  });

  const today = new Date();
  const results: WithdrawalRecord[] = [];

  for (const row of rows) {
    let details: Record<string, string | number> = {};
    try { details = JSON.parse(row.details); } catch { continue; }

    const withdrawalDays = Number(details.withdrawal_days ?? details.withdrawalDays ?? 0);
    if (!withdrawalDays) continue;

    const observedAt = new Date(row.observedAt);
    const withdrawalEnd = new Date(observedAt);
    withdrawalEnd.setDate(withdrawalEnd.getDate() + withdrawalDays);

    const daysRemaining = Math.ceil((withdrawalEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysRemaining <= 0) continue;

    results.push({
      id: row.id,
      animalId: row.animalId,
      campId: row.campId,
      drug: String(details.drug ?? details.treatment ?? "Onbekend"),
      daysRemaining,
      observedAt: toDateString(observedAt),
    });
  }

  return results.sort((a, b) => a.daysRemaining - b.daysRemaining);
}
