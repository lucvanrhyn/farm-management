/**
 * @vitest-environment node
 *
 * Investigation: Sync-truthfulness lie + movement-not-reaching-Admin (2026-05-10).
 *
 * Reproduction context:
 *   - Codex computer-use audit on https://www.farmtrack.app found that Logger
 *     UI shows "Synced: Just now" while pendingCount > 0 and the records never
 *     appear in /admin/observations.
 *   - Affected types: health_issue, animal_movement.
 *   - Successful types in the same session: weighing, treatment, camp_check,
 *     heat_detection.
 *
 * Root-cause hypothesis (CONFIRMED by reading code):
 *   The client (`app/[farmSlug]/logger/[campId]/page.tsx`) submits with
 *     - type: "health_issue"   (handleHealthSubmit, line 191)
 *     - type: "animal_movement"(handleMovementSubmit, line 209)
 *   The server allowlist `VALID_OBSERVATION_TYPES` in
 *   `lib/domain/observations/create-observation.ts` does NOT include either
 *   string. It includes "mob_movement" (the bulk move) but no individual
 *   "animal_movement". It includes nothing at all for individual health
 *   reports.
 *
 *   On submission `createObservation` throws `InvalidTypeError`, the
 *   `tenantWrite` adapter returns 422 INVALID_TYPE, sync-manager logs a
 *   console.warn, marks the observation `failed` (it stays counted by
 *   `getPendingCount`), but `syncAndRefresh` STILL calls `setLastSyncedAt`
 *   unconditionally at the end of `refreshCachedData()`.
 *
 *   Result: "Synced: Just now" timestamp updates while pending > 0, AND the
 *   row never reaches the database, so /admin/observations never sees it.
 *
 * The failing assertions below describe the CORRECT contract — that the
 * client and server agree on the set of valid observation types submitted by
 * the Logger forms. On main, the contract is broken: the test fails.
 */
import { describe, expect, it } from "vitest";

import { VALID_OBSERVATION_TYPES } from "@/lib/domain/observations/create-observation";

/**
 * Type strings the Logger UI emits via `queueObservation({ type, ... })`
 * in `app/[farmSlug]/logger/[campId]/page.tsx` (handlers handleHealthSubmit,
 * handleMovementSubmit, handleDeathSubmit, etc., as of 935418e on main).
 *
 * Pulled from the source file by literal string match, so this list is the
 * client-side ground truth. The server contract MUST be a superset.
 */
const LOGGER_EMITTED_TYPES = [
  "camp_check",
  "health_issue",
  "animal_movement",
  "death",
  "weighing",
  "treatment",
  "camp_condition",
  // calving / pregnancy_scan / heat_detection / insemination / drying_off
  // / weaning all flow through handleReproSubmit which forwards `data.type`
  // verbatim from the reproduction sub-form. Those values are already in the
  // server allowlist; we test the explicit-string handlers above.
] as const;

describe("Logger -> server observation-type contract", () => {
  it("every type the Logger forms emit is accepted by the server allowlist", () => {
    const missing = LOGGER_EMITTED_TYPES.filter(
      (t) => !VALID_OBSERVATION_TYPES.has(t),
    );
    // FAILS on main: ["health_issue", "animal_movement"] are in the Logger
    // handlers but absent from VALID_OBSERVATION_TYPES, so the server returns
    // 422 INVALID_TYPE, the row never persists, and /admin/observations shows
    // nothing. Meanwhile the LoggerStatusBar shows "Synced: Just now".
    expect(missing, `Logger emits types the server rejects: ${missing.join(", ")}`).toEqual([]);
  });

  it("specifically includes health_issue (HealthIssueForm submit path)", () => {
    expect(VALID_OBSERVATION_TYPES.has("health_issue")).toBe(true);
  });

  it("specifically includes animal_movement (MovementForm submit path)", () => {
    expect(VALID_OBSERVATION_TYPES.has("animal_movement")).toBe(true);
  });
});
