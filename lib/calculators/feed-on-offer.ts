// Pure Feed on Offer helpers — no side effects, no Prisma, no network.
// Feed on Offer (kg DM/ha) is the farm's grass inventory and the foundation of
// all grazing management decisions in SA.
//
// SA standards:
//   - Daily DMI per LSU: 10 kg DM/day (DALRRD official standard)
//   - Use factor: 35% of standing biomass consumed before moving (default)
//   - Thresholds derived from SA bushveld/highveld ranges

// ── Thresholds (constants) ────────────────────────────────────────────────────

/** Feed on Offer below this = critical — veld cannot sustain grazing. */
export const FEED_ON_OFFER_CRITICAL_KG_DM = 500;

/** Feed on Offer below this = low — reduced carrying capacity, monitor closely. */
export const FEED_ON_OFFER_LOW_KG_DM = 1000;

/** Feed on Offer at or above this = good — healthy grazing. */
export const FEED_ON_OFFER_GOOD_KG_DM = 2000;

/** Cover reading older than this many days = stale. */
export const FEED_ON_OFFER_STALE_DAYS = 30;

/** Daily dry matter intake per LSU (kg DM/day), SA DALRRD standard. */
export const DAILY_DMI_PER_LSU = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

export type FeedOnOfferStatus = 'critical' | 'low' | 'adequate' | 'good' | 'unknown';

export interface CampFeedOnOfferInput {
  readonly kgDmPerHa: number | null;
  readonly useFactor: number | null;
  readonly sizeHectares: number | null;
  readonly recordedAt: string | null; // ISO date string
}

export interface CampFeedOnOfferResult {
  readonly kgDmPerHa: number | null;
  readonly effectiveFeedOnOfferKg: number | null;
  readonly capacityLsuDays: number | null;
  readonly status: FeedOnOfferStatus;
  readonly daysSinceReading: number | null;
  readonly isStale: boolean;
}

export interface FarmFeedOnOfferSummary {
  readonly totalPastureInventoryKg: number;
  readonly averageFeedOnOfferKgDmPerHa: number | null;
  readonly totalCapacityLsuDays: number;
  readonly campsCritical: number;
  readonly campsLow: number;
  readonly campsAdequate: number;
  readonly campsGood: number;
  readonly campsNoData: number;
  readonly campsStaleReading: number;
}

export interface FeedOnOfferTrendPoint {
  readonly date: string; // YYYY-MM-DD
  readonly kgDmPerHa: number;
}

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Classify Feed on Offer level into a status bucket.
 *   null → unknown
 *   < 500 → critical
 *   < 1000 → low
 *   < 2000 → adequate
 *   ≥ 2000 → good
 */
export function classifyFeedOnOfferStatus(kgDmPerHa: number | null): FeedOnOfferStatus {
  if (kgDmPerHa == null) return 'unknown';
  if (kgDmPerHa < FEED_ON_OFFER_CRITICAL_KG_DM) return 'critical';
  if (kgDmPerHa < FEED_ON_OFFER_LOW_KG_DM) return 'low';
  if (kgDmPerHa < FEED_ON_OFFER_GOOD_KG_DM) return 'adequate';
  return 'good';
}

/**
 * Compute Feed on Offer metrics for a single camp from its latest cover reading.
 *
 * effectiveFeedOnOfferKg = kgDmPerHa × useFactor × sizeHectares
 * capacityLsuDays = effectiveFeedOnOfferKg / DAILY_DMI_PER_LSU
 */
export function calcCampFeedOnOffer(input: CampFeedOnOfferInput, now: Date): CampFeedOnOfferResult {
  const { kgDmPerHa, useFactor, sizeHectares, recordedAt } = input;

  const status = classifyFeedOnOfferStatus(kgDmPerHa);

  // Staleness
  let daysSinceReading: number | null = null;
  let isStale = true; // no reading = stale
  if (recordedAt != null) {
    const readingDate = new Date(recordedAt);
    const diffMs = now.getTime() - readingDate.getTime();
    daysSinceReading = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    isStale = daysSinceReading > FEED_ON_OFFER_STALE_DAYS;
  }

  // Effective Feed on Offer and capacity
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
      effectiveFeedOnOfferKg: null,
      capacityLsuDays: null,
      status,
      daysSinceReading,
      isStale,
    };
  }

  const effectiveFeedOnOfferKg = kgDmPerHa! * useFactor! * sizeHectares!;
  const capacityLsuDays = effectiveFeedOnOfferKg / DAILY_DMI_PER_LSU;

  return {
    kgDmPerHa,
    effectiveFeedOnOfferKg,
    capacityLsuDays,
    status,
    daysSinceReading,
    isStale,
  };
}

/**
 * Aggregate Feed on Offer metrics across all camps on a farm.
 */
export function calcFarmFeedOnOfferSummary(
  camps: readonly CampFeedOnOfferResult[],
): FarmFeedOnOfferSummary {
  let totalPastureInventoryKg = 0;
  let totalCapacityLsuDays = 0;
  let feedOnOfferSum = 0;
  let feedOnOfferCount = 0;
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

    if (camp.effectiveFeedOnOfferKg != null) {
      totalPastureInventoryKg += camp.effectiveFeedOnOfferKg;
    }
    if (camp.capacityLsuDays != null) {
      totalCapacityLsuDays += camp.capacityLsuDays;
    }
    if (camp.kgDmPerHa != null) {
      feedOnOfferSum += camp.kgDmPerHa;
      feedOnOfferCount++;
    }
    if (camp.isStale) {
      campsStaleReading++;
    }
  }

  return {
    totalPastureInventoryKg,
    averageFeedOnOfferKgDmPerHa: feedOnOfferCount > 0 ? feedOnOfferSum / feedOnOfferCount : null,
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
export function calcFeedOnOfferTrendSlope(
  points: readonly FeedOnOfferTrendPoint[],
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
