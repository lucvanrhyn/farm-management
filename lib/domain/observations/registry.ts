/**
 * Issue #319 (PRD #318 stress-test remediation, wave R1).
 *
 * Single canonical source of truth for every valid observation type.
 *
 * Before this file existed, the persistence allowlist
 * (`VALID_OBSERVATION_TYPES` in `create-observation.ts`) and the UI enum
 * (`ReproType` in `components/logger/ReproductionForm.tsx`) were independent
 * declarations with no contract binding them. They drifted: the
 * ReproductionForm could emit `body_condition_score`, `temperament_score`,
 * and `scrotal_circumference`, none of which were in the persistence
 * allowlist, so those observations died permanently at the write boundary
 * with HTTP 422 INVALID_TYPE.
 *
 * Both the string-literal union `ObservationType` and the runtime allowlist
 * `OBSERVATION_TYPES` are derived from the same single array literal below,
 * so the compile-time type and the runtime set can never drift again.
 * `__tests__/observations/observation-type-registry-contract.test.ts` locks
 * the regression by asserting every ReproductionForm-emittable type is a
 * member of the runtime allowlist.
 */

/**
 * The one and only declaration of valid observation types.
 *
 * `as const` makes this a readonly tuple of string literals, which is what
 * lets us derive a precise union type from the same value the runtime set is
 * built from. Add a new type HERE and it is simultaneously accepted by the
 * persistence allowlist and assignable to the UI `ObservationType`.
 */
export const OBSERVATION_TYPE_LIST = [
  // Existing 20 types — previously declared inline in create-observation.ts.
  "camp_condition",
  "camp_check",
  "calving",
  "pregnancy_scan",
  "weighing",
  "treatment",
  "heat_detection",
  "insemination",
  "drying_off",
  "weaning",
  "death",
  "mob_movement",
  "animal_movement",
  "health_issue",
  "general",
  "dosing",
  "shearing",
  "lambing",
  "game_census",
  "game_sighting",
  // #319 — ReproductionForm scored / measured sub-flows. The UI + server
  // validators already accept these; they were missing only from the
  // persistence allowlist, so the write threw InvalidTypeError.
  "body_condition_score",
  "temperament_score",
  "scrotal_circumference",
] as const;

/** Canonical string-literal union of every valid observation type. */
export type ObservationType = (typeof OBSERVATION_TYPE_LIST)[number];

/**
 * Runtime allowlist of valid observation type strings, derived from the same
 * list as {@link ObservationType}.
 */
export const OBSERVATION_TYPES: ReadonlySet<ObservationType> = new Set(
  OBSERVATION_TYPE_LIST,
);
