/**
 * Wave G2 (#166) — domain-layer typed errors for `lib/domain/rotation/*`.
 *
 * Each error wraps a SCREAMING_SNAKE wire code that `mapApiDomainError`
 * (in `lib/server/api-errors.ts`) maps onto an HTTP envelope. Wire shape
 * is `{ error: CODE }` for the bare codes and `{ error: CODE, details: { field, ... } }`
 * for the field-bearing variants — matching the typed-error envelope
 * pattern established in Waves D-G1.
 *
 * Wave G2 wire-shape migrations vs. pre-G2 rotation routes:
 *   - 404 "Plan not found"           → `{ error: "PLAN_NOT_FOUND" }`
 *   - 404 "Step not found"           → `{ error: "STEP_NOT_FOUND" }`
 *   - 409 "Step is already executed" → `{ error: "STEP_ALREADY_EXECUTED" }`
 *   - 400 "Invalid status"           → `{ error: "INVALID_STATUS",
 *                                          details: { field, allowed } }`
 *   - 400 "name cannot be blank"     → `{ error: "BLANK_NAME" }`
 *   - 400 "Invalid startDate"        → `{ error: "INVALID_DATE",
 *                                          details: { field } }`
 *   - 400 "<field> is required"      → `{ error: "MISSING_FIELD",
 *                                          details: { field } }`
 *   - 400 "plannedDays must be ..."  → `{ error: "INVALID_PLANNED_DAYS" }`
 *   - 400 "order must be ..."        → `{ error: "INVALID_ORDER",
 *                                          details: { expected, actual } }`
 *   - 400 "mobId is required..."     → `{ error: "MISSING_MOB_ID" }`
 *   - 409 "already in camp"          → `{ error: "MOB_ALREADY_IN_CAMP" }`
 *
 * `MobNotFoundError` from `lib/domain/mobs/move-mob` is re-thrown
 * unchanged — `mapApiDomainError` already maps it to 404 "Mob not found".
 */

export const PLAN_NOT_FOUND = "PLAN_NOT_FOUND" as const;
export const STEP_NOT_FOUND = "STEP_NOT_FOUND" as const;
export const STEP_ALREADY_EXECUTED = "STEP_ALREADY_EXECUTED" as const;
export const INVALID_STATUS = "INVALID_STATUS" as const;
export const BLANK_NAME = "BLANK_NAME" as const;
export const INVALID_DATE = "INVALID_DATE" as const;
export const MISSING_FIELD = "MISSING_FIELD" as const;
export const INVALID_PLANNED_DAYS = "INVALID_PLANNED_DAYS" as const;
export const INVALID_ORDER = "INVALID_ORDER" as const;
export const MISSING_MOB_ID = "MISSING_MOB_ID" as const;
export const MOB_ALREADY_IN_CAMP = "MOB_ALREADY_IN_CAMP" as const;

/**
 * Field name carried by `INVALID_DATE.details.field`. Wave G2 only emits
 * `startDate` (plan create / patch) and `plannedStart` (step create) — but
 * the type is `string` so future date-bearing rotation fields can plug in
 * without a type churn.
 */
export type InvalidDateField = "startDate" | "plannedStart";

/**
 * Field name carried by `MISSING_FIELD.details.field`. Listed are every
 * required string/array top-level rotation payload field — write ops
 * throw with the offending key so the UI can highlight the right input.
 */
export type MissingField = "name" | "startDate" | "campId" | "plannedStart";

/** Allowed rotation plan statuses. PATCH validates against this list. */
export const ROTATION_PLAN_STATUSES = [
  "draft",
  "active",
  "completed",
  "archived",
] as const;
export type RotationPlanStatus = (typeof ROTATION_PLAN_STATUSES)[number];

/**
 * No rotation plan with the given id exists in the tenant. Wire: 404
 * `{ error: "PLAN_NOT_FOUND" }`.
 */
export class PlanNotFoundError extends Error {
  readonly code = PLAN_NOT_FOUND;
  readonly planId: string;
  constructor(planId: string) {
    super(`Plan not found: ${planId}`);
    this.name = "PlanNotFoundError";
    this.planId = planId;
  }
}

/**
 * No rotation plan step with the given id exists (or the step does not
 * belong to the plan in the URL). Wire: 404 `{ error: "STEP_NOT_FOUND" }`.
 */
export class StepNotFoundError extends Error {
  readonly code = STEP_NOT_FOUND;
  readonly stepId: string;
  constructor(stepId: string) {
    super(`Step not found: ${stepId}`);
    this.name = "StepNotFoundError";
    this.stepId = stepId;
  }
}

/**
 * Caller tried to execute a step that has already been executed (or
 * skipped). Wire: 409 `{ error: "STEP_ALREADY_EXECUTED",
 * details: { currentStatus } }`. Carries the current status so the UI
 * can render a precise toast (e.g. "skipped — cannot execute").
 */
export class StepAlreadyExecutedError extends Error {
  readonly code = STEP_ALREADY_EXECUTED;
  readonly currentStatus: string;
  constructor(currentStatus: string, message?: string) {
    super(
      message ??
        `Step is already ${currentStatus} and cannot be executed again`,
    );
    this.name = "StepAlreadyExecutedError";
    this.currentStatus = currentStatus;
  }
}

/**
 * `status` field on a PATCH was not one of the allowed values. Wire: 400
 * `{ error: "INVALID_STATUS", details: { field, allowed } }`.
 */
export class InvalidStatusError extends Error {
  readonly code = INVALID_STATUS;
  readonly field = "status" as const;
  readonly allowed: ReadonlyArray<RotationPlanStatus>;
  constructor(allowed: ReadonlyArray<RotationPlanStatus> = ROTATION_PLAN_STATUSES) {
    super(`Invalid status — allowed: ${allowed.join(", ")}`);
    this.name = "InvalidStatusError";
    this.allowed = allowed;
  }
}

/**
 * `name` was provided but trimmed to empty. Wire: 400
 * `{ error: "BLANK_NAME" }`. (Distinguished from `MissingFieldError` —
 * the field is technically present but unusable.)
 */
export class BlankNameError extends Error {
  readonly code = BLANK_NAME;
  constructor(message?: string) {
    super(message ?? "name cannot be blank");
    this.name = "BlankNameError";
  }
}

/**
 * A date-typed field could not be parsed. Wire: 400
 * `{ error: "INVALID_DATE", details: { field } }`. Carries the field so
 * the UI can highlight the bad input (`startDate` vs `plannedStart`).
 */
export class InvalidDateError extends Error {
  readonly code = INVALID_DATE;
  readonly field: InvalidDateField;
  constructor(field: InvalidDateField, message?: string) {
    super(message ?? `Invalid ${field}`);
    this.name = "InvalidDateError";
    this.field = field;
  }
}

/**
 * A required top-level rotation payload field is missing or empty. Wire:
 * 400 `{ error: "MISSING_FIELD", details: { field } }`.
 */
export class MissingFieldError extends Error {
  readonly code = MISSING_FIELD;
  readonly field: MissingField;
  constructor(field: MissingField, message?: string) {
    super(message ?? `${field} is required`);
    this.name = "MissingFieldError";
    this.field = field;
  }
}

/**
 * `plannedDays` was not a positive integer. Wire: 400
 * `{ error: "INVALID_PLANNED_DAYS" }`.
 */
export class InvalidPlannedDaysError extends Error {
  readonly code = INVALID_PLANNED_DAYS;
  constructor(message?: string) {
    super(message ?? "plannedDays must be a positive integer");
    this.name = "InvalidPlannedDaysError";
  }
}

/**
 * `order` array is not a permutation of the plan's pending step IDs (wrong
 * length, missing IDs, or extra IDs). Wire: 400
 * `{ error: "INVALID_ORDER", details: { expected, actual } }`.
 */
export class InvalidOrderError extends Error {
  readonly code = INVALID_ORDER;
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number, message?: string) {
    super(
      message ??
        `order must be a permutation of the plan's pending step IDs (expected ${expected}, got ${actual})`,
    );
    this.name = "InvalidOrderError";
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Execute called without a `mobId` and the step has no default mob to
 * fall back to. Wire: 400 `{ error: "MISSING_MOB_ID" }`.
 */
export class MissingMobIdError extends Error {
  readonly code = MISSING_MOB_ID;
  constructor(message?: string) {
    super(
      message ??
        "mobId is required (step has no default mob; provide one in the request body)",
    );
    this.name = "MissingMobIdError";
  }
}

/**
 * `performMobMove` rejected because the mob is already in the destination
 * camp. Wire: 409 `{ error: "MOB_ALREADY_IN_CAMP" }`. Re-thrown from
 * `execute-step` as a typed error so `mapApiDomainError` can mint the
 * canonical envelope.
 */
export class MobAlreadyInCampError extends Error {
  readonly code = MOB_ALREADY_IN_CAMP;
  constructor(message?: string) {
    super(message ?? "Mob is already in the destination camp");
    this.name = "MobAlreadyInCampError";
  }
}
