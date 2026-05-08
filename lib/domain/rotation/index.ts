/**
 * Wave G2 (#166) — public surface of the rotation domain ops.
 *
 * Each op is a pure function on `(prisma, ...)` that returns plain
 * JSON-serialisable data and throws typed errors for business-rule
 * violations. The transport adapters (`tenantReadSlug`, `adminWriteSlug`)
 * wire these into HTTP route handlers; the typed errors map onto the
 * wire envelope via `mapApiDomainError`.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-166-rotation.md`.
 */
export {
  getRotationStatusByCamp,
  type CampRotationStatus,
  type RotationMobSummary,
  type RotationPayload,
} from "./get-status";

export { listRotationPlans } from "./list-plans";
export { getRotationPlan, getRotationPlanOrThrow } from "./get-plan";
export {
  createRotationPlan,
  type CreateRotationPlanInput,
  type CreateRotationPlanStepInput,
} from "./create-plan";
export {
  updateRotationPlan,
  type UpdateRotationPlanInput,
} from "./update-plan";
export { deleteRotationPlan } from "./delete-plan";
export {
  addRotationPlanStep,
  type AddRotationPlanStepInput,
} from "./add-step";
export {
  reorderRotationPlanSteps,
  type ReorderRotationPlanStepsInput,
} from "./reorder-steps";
export {
  executeRotationPlanStep,
  type ExecuteRotationPlanStepInput,
  type ExecuteRotationPlanStepResult,
} from "./execute-step";

export {
  PlanNotFoundError,
  StepNotFoundError,
  StepAlreadyExecutedError,
  InvalidStatusError,
  BlankNameError,
  InvalidDateError,
  MissingFieldError,
  InvalidPlannedDaysError,
  InvalidOrderError,
  MissingMobIdError,
  MobAlreadyInCampError,
  PLAN_NOT_FOUND,
  STEP_NOT_FOUND,
  STEP_ALREADY_EXECUTED,
  INVALID_STATUS,
  BLANK_NAME,
  INVALID_DATE,
  MISSING_FIELD,
  INVALID_PLANNED_DAYS,
  INVALID_ORDER,
  MISSING_MOB_ID,
  MOB_ALREADY_IN_CAMP,
  ROTATION_PLAN_STATUSES,
  type InvalidDateField,
  type MissingField,
  type RotationPlanStatus,
} from "./errors";
