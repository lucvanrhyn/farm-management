// lib/server/alerts/stale-inspection.ts — the SHARED stale-camp-inspection rule.
//
// Proactive Nudges v1 (#nudges) — the stale-camp-inspection detection used to
// live ONLY inside `composeAlerts` (lib/server/alerts/compose.ts, the
// "stale-inspections" dashboard alert). The NEEDS_INSPECTION_DUE notification
// generator needs the SAME rule (same threshold, same counting), so the math is
// extracted here as a pure function and BOTH surfaces call it — there is no
// second threshold to drift.
//
// PURE + TOTAL: same inputs → same output, no I/O, no clock read (the caller
// passes `now`). Mirrors the contract `compose.ts` holds for alerts.

import type { LiveCampStatus } from "@/lib/server/camp-status";

/**
 * Count the camps that count as "stale inspection":
 *   - every camp WITHOUT a condition row (uninspected): `totalCamps - size`, plus
 *   - every camp WITH a condition row older than the threshold (aged).
 *
 * `totalCamps == null` ⇒ 0 (the source did not contribute — identical to the
 * absent-source semantics in compose.ts). This is the exact rule the
 * "stale-inspections" dashboard alert used pre-extraction.
 */
export function computeStaleCampInspectionCount(
  campConditions: Map<string, LiveCampStatus>,
  totalCamps: number | null,
  staleCampInspectionHours: number,
  now: Date,
): number {
  if (totalCamps == null) return 0;
  const staleThresholdMs = staleCampInspectionHours * 60 * 60 * 1000;
  let count = totalCamps - campConditions.size; // uninspected
  for (const condition of campConditions.values()) {
    const inspectedAt = new Date(condition.last_inspected_at);
    const ageMs = now.getTime() - inspectedAt.getTime();
    if (ageMs > staleThresholdMs) count++;
  }
  return count;
}

/**
 * The per-camp companion of `computeStaleCampInspectionCount`: which camp ids
 * are stale. Used by the NEEDS_INSPECTION_DUE generator to emit one targeted
 * candidate per camp (the dashboard alert only needs the aggregate count, so it
 * uses the count helper above). `allCampIds` is the full camp roster — any id
 * missing from `campConditions` is "uninspected" and therefore stale.
 */
export function computeStaleCampIds(
  campConditions: Map<string, LiveCampStatus>,
  allCampIds: readonly string[],
  staleCampInspectionHours: number,
  now: Date,
): string[] {
  const staleThresholdMs = staleCampInspectionHours * 60 * 60 * 1000;
  const stale: string[] = [];
  for (const campId of allCampIds) {
    const condition = campConditions.get(campId);
    if (!condition) {
      stale.push(campId); // never inspected
      continue;
    }
    const inspectedAt = new Date(condition.last_inspected_at);
    const ageMs = now.getTime() - inspectedAt.getTime();
    if (ageMs > staleThresholdMs) stale.push(campId);
  }
  return stale;
}
