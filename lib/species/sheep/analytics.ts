// lib/species/sheep/analytics.ts — Pure helper functions for sheep analytics

import type { UpcomingBirth } from "../types";

const GESTATION_DAYS = 150;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysDiff(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Compute upcoming lambing dates from joining observations.
 * Expected lambing = joining date + 150 days.
 * Only returns entries where daysAway is between -7 and 90.
 *
 * `activeAnimalIds` is the active ewe roster. Joining observations persist
 * after a ewe dies / is sold / is culled, so the projection MUST be intersected
 * with the active roster — otherwise a non-active ewe is surfaced as "due to
 * lamb" on /sheep/reproduction and in the "Due <30 days" KPI (ADR-0010
 * same-population invariant). Required (not optional) so every call site is
 * forced to supply it — the structural cure for this leak class.
 */
export function getUpcomingLambings(
  joiningObs: Array<{
    animalId: string | null;
    campId: string;
    observedAt: Date;
    details: string;
  }>,
  campMap: Map<string, string>,
  activeAnimalIds: ReadonlySet<string>,
): UpcomingBirth[] {
  const now = new Date();
  const results: UpcomingBirth[] = [];

  for (const obs of joiningObs) {
    if (!obs.animalId) continue;
    if (!activeAnimalIds.has(obs.animalId)) continue;

    const expectedDate = new Date(
      obs.observedAt.getTime() + GESTATION_DAYS * MS_PER_DAY,
    );
    const daysAway = daysDiff(now, expectedDate);

    if (daysAway < -7 || daysAway > 90) continue;

    results.push({
      animalId: obs.animalId,
      campId: obs.campId,
      campName: campMap.get(obs.campId) ?? obs.campId,
      expectedDate,
      daysAway,
      source: "joining",
    });
  }

  return results;
}

/**
 * Compute lambing percentage: actual lambings / ewes joined × 100.
 * Returns null when no joinings have been recorded.
 */
export function calcLambingPercentage(
  joiningCount: number,
  lambingCount: number,
): number | null {
  if (joiningCount === 0) return null;
  return Math.round((lambingCount / joiningCount) * 100 * 10) / 10;
}

/**
 * Returns the number of days since the most recent shearing observation,
 * or null when no shearing is on record.
 */
export function daysSinceLastShearing(
  shearingObs: Array<{ observedAt: Date }>,
): number | null {
  if (shearingObs.length === 0) return null;

  const latest = shearingObs.reduce((best, obs) =>
    obs.observedAt > best.observedAt ? obs : best,
  );

  return daysDiff(latest.observedAt, new Date());
}

/**
 * Returns animalIds that are overdue for dosing (default: >90 days since last
 * dosing observation, or never dosed).
 *
 * Each entry in dosingObs represents a single dosing event for an animal.
 * We find the most recent dosing per animal and flag those beyond cutoffDays.
 * Animals that appear in activeAnimalIds but never in dosingObs are also flagged.
 */
export function getDosingOverdue(
  dosingObs: Array<{ animalId: string | null; observedAt: Date }>,
  cutoffDays = 90,
): string[] {
  const now = new Date();
  const latestByAnimal = new Map<string, Date>();

  for (const obs of dosingObs) {
    if (!obs.animalId) continue;
    const current = latestByAnimal.get(obs.animalId);
    if (!current || obs.observedAt > current) {
      latestByAnimal.set(obs.animalId, obs.observedAt);
    }
  }

  const overdue: string[] = [];
  for (const [animalId, lastDosed] of latestByAnimal) {
    const days = daysDiff(lastDosed, now);
    if (days > cutoffDays) {
      overdue.push(animalId);
    }
  }

  return overdue;
}
