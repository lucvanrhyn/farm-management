// Pure pasture rotation helpers — no side effects, no Prisma, no network.
// Everything here is unit-testable in isolation.

import { resolveRestDayModifier } from './veld-score';

export type VeldType = 'sweetveld' | 'sourveld' | 'mixedveld' | 'cultivated';

export type RotationSeasonMode = 'auto' | 'growing' | 'dormant';

export type RotationStatus =
  | 'grazing'
  | 'overstayed'
  | 'resting'
  | 'resting_ready'
  | 'overdue_rest'
  | 'unknown';

export interface RotationSettings {
  readonly defaultRestDays: number;
  readonly defaultMaxGrazingDays: number;
  readonly rotationSeasonMode: RotationSeasonMode;
  readonly dormantSeasonMultiplier: number;
}

export interface CampRotationConfig {
  readonly veldType: VeldType | null;
  readonly restDaysOverride: number | null;
  readonly maxGrazingDaysOverride: number | null;
}

export interface ClassifyInput {
  readonly isOccupied: boolean;
  readonly daysGrazed: number | null;
  readonly daysRested: number | null;
  readonly effectiveMaxGrazingDays: number;
  readonly effectiveRestDays: number;
}

/**
 * Base rest-period baselines per veld type (days).
 * Conservative SA averages — farmers override via FarmSettings or Camp.
 */
export const VELD_TYPE_BASELINE: Readonly<Record<VeldType, number>> = {
  sweetveld: 75,
  sourveld: 50,
  mixedveld: 60,
  cultivated: 30,
};

/** Safe global fallback when no baseline, no default, no override is provided. */
export const DEFAULT_REST_DAYS_FALLBACK = 60;
export const DEFAULT_MAX_GRAZING_DAYS_FALLBACK = 7;

/**
 * SA summer-rainfall convention: growing season Oct–Mar, dormant Apr–Sep.
 * Months are 1-indexed (Jan = 1).
 */
export function isGrowingSeasonMonth(month: number): boolean {
  return month >= 10 || month <= 3;
}

/**
 * Returns the multiplier to apply to baseline rest days for the given season.
 * In "auto" mode, month is used to decide growing vs dormant.
 */
export function resolveSeasonalMultiplier(
  settings: RotationSettings,
  now: Date,
): number {
  const mode: RotationSeasonMode = settings.rotationSeasonMode;
  if (mode === 'growing') return 1;
  if (mode === 'dormant') return settings.dormantSeasonMultiplier;
  // auto
  const month = now.getMonth() + 1;
  return isGrowingSeasonMonth(month) ? 1 : settings.dormantSeasonMultiplier;
}

/**
 * Effective rest days for a camp, applying this precedence:
 *   1. camp.restDaysOverride (farmer pinned a value for this camp)
 *   2. farmSettings.defaultRestDays (farm-wide default)
 *   3. VELD_TYPE_BASELINE[camp.veldType]
 *   4. DEFAULT_REST_DAYS_FALLBACK
 *
 * The resulting value is then multiplied by the seasonal multiplier.
 * Override wins absolutely — the seasonal multiplier is NOT applied on
 * overrides because an override is interpreted as "final answer for this camp".
 */
export function resolveEffectiveRestDays(
  camp: CampRotationConfig,
  settings: RotationSettings,
  now: Date,
  veldScore: number | null = null,
): number {
  if (camp.restDaysOverride != null) {
    return camp.restDaysOverride;
  }
  const base =
    settings.defaultRestDays ??
    (camp.veldType ? VELD_TYPE_BASELINE[camp.veldType] : null) ??
    DEFAULT_REST_DAYS_FALLBACK;
  const seasonal = resolveSeasonalMultiplier(settings, now);
  const veldMod = resolveRestDayModifier(veldScore);
  return Math.round(base * seasonal * veldMod);
}

/**
 * Effective max grazing days for a camp (how long before we call it overstayed).
 * No seasonal modifier — grazing capacity is about forage availability, not season.
 */
export function resolveEffectiveMaxGrazingDays(
  camp: CampRotationConfig,
  settings: RotationSettings,
): number {
  if (camp.maxGrazingDaysOverride != null) {
    return camp.maxGrazingDaysOverride;
  }
  return settings.defaultMaxGrazingDays ?? DEFAULT_MAX_GRAZING_DAYS_FALLBACK;
}

/**
 * Days between two dates, floored. Returns 0 if end < start.
 */
export function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Classify a camp's rotation status from derived inputs.
 *
 * Status semantics:
 *   grazing       — animals present, within max grazing window
 *   overstayed    — animals present, exceeded max grazing window (red alert)
 *   resting       — no animals, rest not yet complete
 *   resting_ready — no animals, rest complete and ready to receive mob
 *   overdue_rest  — no animals, rested too long (>2× target), veld may be declining
 *   unknown       — insufficient data (never grazed, etc.)
 */
export function classifyCampStatus(input: ClassifyInput): RotationStatus {
  const {
    isOccupied,
    daysGrazed,
    daysRested,
    effectiveMaxGrazingDays,
    effectiveRestDays,
  } = input;

  if (isOccupied) {
    if (daysGrazed == null) return 'grazing';
    return daysGrazed > effectiveMaxGrazingDays ? 'overstayed' : 'grazing';
  }

  if (daysRested == null) return 'unknown';

  if (daysRested >= effectiveRestDays * 2) return 'overdue_rest';
  if (daysRested >= effectiveRestDays) return 'resting_ready';
  return 'resting';
}

/**
 * LSU capacity for a camp = available forage / daily-LSU demand.
 *
 * Formula:
 *   effective_foo (kg DM) = kgDmPerHa * useFactor * sizeHectares
 *   daily_demand_per_lsu  = 10 kg DM
 *   capacityLsuDays       = effective_foo / daily_demand_per_lsu
 *
 * Returns null when any input is missing. This is a pure form of
 * `calcDaysGrazingRemaining` rearranged to express "LSU-days of forage".
 */
export function calcCampLsuDays(
  kgDmPerHa: number | null,
  useFactor: number | null,
  sizeHectares: number | null,
): number | null {
  if (
    kgDmPerHa == null ||
    useFactor == null ||
    sizeHectares == null ||
    kgDmPerHa <= 0 ||
    useFactor <= 0 ||
    sizeHectares <= 0
  ) {
    return null;
  }
  return (kgDmPerHa * useFactor * sizeHectares) / 10;
}

export interface RankableCamp {
  readonly campId: string;
  readonly status: RotationStatus;
  readonly daysRested: number | null;
  readonly capacityLsuDays: number | null;
}

/**
 * Sort "ready" and "overdue_rest" camps into a priority queue for next grazing.
 * Primary: longest rested first. Tiebreaker: larger capacity first.
 * "overdue_rest" camps come first (veld is starting to decline — graze soon
 * to reset productivity).
 */
export function rankNextToGraze<T extends RankableCamp>(camps: readonly T[]): T[] {
  const statusRank: Record<RotationStatus, number> = {
    overdue_rest: 0,
    resting_ready: 1,
    resting: 2,
    grazing: 3,
    overstayed: 4,
    unknown: 5,
  };
  return [...camps]
    .filter((c) => c.status === 'resting_ready' || c.status === 'overdue_rest')
    .sort((a, b) => {
      const byStatus = statusRank[a.status] - statusRank[b.status];
      if (byStatus !== 0) return byStatus;
      const byRest = (b.daysRested ?? 0) - (a.daysRested ?? 0);
      if (byRest !== 0) return byRest;
      return (b.capacityLsuDays ?? 0) - (a.capacityLsuDays ?? 0);
    });
}
