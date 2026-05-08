/**
 * Wave E (#161) — public surface of the tasks domain ops.
 *
 * Each op is a pure function on `(prisma, ...)` that returns plain
 * JSON-serialisable data and throws typed errors for business-rule
 * violations. The transport adapters (`tenantRead`, `adminWrite`) wire
 * these into HTTP route handlers; the typed errors map onto the wire
 * envelope via `mapApiDomainError`.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-161-tasks-domain.md`.
 */
export {
  listTasksUnbounded,
  listTasksPaginated,
  listTaskOccurrences,
  parseTaskArrayFields,
  safeParseArray,
  MAX_LIMIT,
  type ListTasksFilters,
  type ListTasksPaginatedArgs,
  type ListTasksPaginatedResult,
  type ListTaskOccurrencesArgs,
} from "./list-tasks";
export {
  createTask,
  type CreateTaskInput,
} from "./create-task";
export {
  updateTask,
  type UpdateTaskInput,
  type UpdateTaskResult,
} from "./update-task";
export {
  deleteTask,
  type DeleteTaskResult,
} from "./delete-task";
export {
  TaskNotFoundError,
  InvalidRecurrenceRuleError,
  TemplateNotFoundError,
  InvalidLimitError,
  InvalidCursorError,
  TASK_NOT_FOUND,
  INVALID_RECURRENCE_RULE,
  TEMPLATE_NOT_FOUND,
  INVALID_LIMIT,
  INVALID_CURSOR,
} from "./errors";
