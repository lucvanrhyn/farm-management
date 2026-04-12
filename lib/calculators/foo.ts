// Pure Feed on Offer (FOO) helpers — no side effects, no Prisma, no network.
// FOO (kg DM/ha) is the farm's grass inventory and the foundation of all
// grazing management decisions in SA.
//
// SA standards:
//   - Daily DMI per LSU: 10 kg DM/day (DALRRD official standard)
//   - Use factor: 35% of standing biomass consumed before moving (default)
//   - FOO thresholds derived from SA bushveld/highveld ranges

// ── Thresholds (constants) ────────────────────────────────────────────────────

/** FOO below this = critical — veld cannot sustain grazing. */
export const FOO_CRITICAL_KG_DM = 500;

/** FOO below this = low — reduced carrying capacity, monitor closely. */
export const FOO_LOW_KG_DM = 1000;

/** FOO at or above this = good — healthy grazing. */
export const FOO_GOOD_KG_DM = 2000;

/** Cover reading older than this many days = stale. */
export const FOO_STALE_DAYS = 30;

/** Daily dry matter intake per LSU (kg DM/day), SA DALRRD standard. */
export const DAILY_DMI_PER_LSU = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

export type FooStatus = 'critical' | 'low' | 'adequate' | 'good' | 'unknown';

export interface CampFooInput {
  readonly kgDmPerHa: number | null;
  readonly useFactor: number | null;
  readonly sizeHectares: number | null;
  readonly recordedAt: string | null; // ISO date string
}

export interface CampFooResult {
  readonly kgDmPerHa: number | null;
  readonly effectiveFooKg: number | null;
  readonly capacityLsuDays: number | null;
  readonly status: FooStatus;
  readonly daysSinceReading: number | null;
  readonly isStale: boolean;
}

export interface FarmFooSummary {
  readonly totalPastureInventoryKg: number;
  readonly averageFooKgDmPerHa: number | null;
  readonly totalCapacityLsuDays: number;
  readonly campsCritical: number;
  readonly campsLow: number;
  readonly campsAdequate: number;
  readonly campsGood: number;
  readonly campsNoData: number;
  readonly campsStaleReading: number;
}

export interface FooTrendPoint {
  readonly date: string; // YYYY-MM-DD
  readonly kgDmPerHa: number;
}

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Classify FOO level into a status bucket.
 *   null → unknown
 *   < 500 → critical
 *   < 1000 → low
 *   < 2000 → adequate
 *   ≥ 2000 → good
 */
export function classifyFooStatus(kgDmPerHa: number | null): FooStatus {
  if (kgDmPerHa == null) return 'unknown';
  if (kgDmPerHa < FOO_CRITICAL_KG_DM) return 'critical';
  if (kgDmPerHa < FOO_LOW_KG_DM) return 'low';
  if (kgDmPerHa < FOO_GOOD_KG_DM) return 'adequate';
  return 'good';
}

/**
 * Compute FOO metrics for a single camp from its latest cover reading.
 *
 * effectiveFooKg = kgDmPerHa × useFactor × sizeHectares
 * capacityLsuDays = effectiveFooKg / DAILY_DMI_PER_LSU
 */
export function calcCampFoo(input: CampFooInput, now: Date): CampFooResult {
  const { kgDmPerHa, useFactor, sizeHectares, recordedAt } = input;

  const status = classifyFooStatus(kgDmPerHa);

  // Staleness
  let daysSinceReading: number | null = null;
  let isStale = true; // no reading = stale
  if (recordedAt != null) {
    const readingDate = new Date(recordedAt);
    const diffMs = now.getTime() - readingDate.getTime();
    daysSinceReading = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    isStale = daysSinceReading > FOO_STALE_DAYS;
  }

  // Effective FOO and capacity
  const canCompute =
    kgDmPerHa != null &&
    kgDmPerHa > 0 &&
    useFactor != null &&
    useFactor > 0 &&
    sizeHectares != null &&
    sizeHectares > 0;

  if (!canCompute) {
    return {
      kgDmPerHa,
      effectiveFooKg: null,
      capacityLsuDays: null,
      status,
      daysSinceReading,
      isStale,
    };
  }

  const effectiveFooKg = kgDmPerHa! * useFactor! * sizeHectares!;
  const capacityLsuDays = effectiveFooKg / DAILY_DMI_PER_LSU;

  return {
    kgDmPerHa,
    effectiveFooKg,
    capacityLsuDays,
    status,
    daysSinceReading,
    isStale,
  };
}

/**
 * Aggregate FOO metrics across all camps on a farm.
 */
export function calcFarmFooSummary(
  camps: readonly CampFooResult[],
): FarmFooSummary {
  let totalPastureInventoryKg = 0;
  let totalCapacityLsuDays = 0;
  let fooSum = 0;
  let fooCount = 0;
  let campsCritical = 0;
  let campsLow = 0;
  let campsAdequate = 0;
  let campsGood = 0;
  let campsNoData = 0;
  let campsStaleReading = 0;

  for (const camp of camps) {
    switch (camp.status) {
      case 'critical':
        campsCritical++;
        break;
      case 'low':
        campsLow++;
        break;
      case 'adequate':
        campsAdequate++;
        break;
      case 'good':
        campsGood++;
        break;
      case 'unknown':
        campsNoData++;
        break;
    }

    if (camp.effectiveFooKg != null) {
      totalPastureInventoryKg += camp.effectiveFooKg;
    }
    if (camp.capacityLsuDays != null) {
      totalCapacityLsuDays += camp.capacityLsuDays;
    }
    if (camp.kgDmPerHa != null) {
      fooSum += camp.kgDmPerHa;
      fooCount++;
    }
    if (camp.isStale) {
      campsStaleReading++;
    }
  }

  return {
    totalPastureInventoryKg,
    averageFooKgDmPerHa: fooCount > 0 ? fooSum / fooCount : null,
    totalCapacityLsuDays,
    campsCritical,
    campsLow,
    campsAdequate,
    campsGood,
    campsNoData,
    campsStaleReading,
  };
}

/**
 * Linear least-squares slope of kgDmPerHa vs months elapsed.
 * Returns kg DM/ha per month. Positive = improving, negative = declining.
 * Returns 0 for <2 points or flat series.
 */
export function calcFooTrendSlope(
  points: readonly FooTrendPoint[],
): number {
  if (points.length < 2) return 0;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const anchor = new Date(sorted[0].date + 'T00:00:00Z').getTime();
  const monthsMs = 1000 * 60 * 60 * 24 * (365.25 / 12);

  const xs = sorted.map(
    (p) => (new Date(p.date + 'T00:00:00Z').getTime() - anchor) / monthsMs,
  );
  const ys = sorted.map((p) => p.kgDmPerHa);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return 0;
  return Number((num / den).toFixed(4));
}
