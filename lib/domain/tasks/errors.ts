/**
 * Wave E (#161) — domain-layer typed errors for `lib/domain/tasks/*`.
 *
 * Each error wraps a SCREAMING_SNAKE wire code. The `mapApiDomainError`
 * helper at `lib/server/api-errors.ts` maps these onto canonical HTTP
 * responses so the wire shape stays backward-compatible with the
 * pre-Wave-E consumers (admin /tasks UI, offline-sync queue, mobile
 * task-completion flow, Inngest task-occurrences workers).
 *
 * IMPORTANT — `TEMPLATE_NOT_FOUND` stays 400, NOT 404. The pre-Wave-E
 * route returned 400 because it's treated as an invalid input error
 * ("you supplied a bad templateId"), not a missing resource. Offline
 * clients code against the 400; do not "improve" it to 404.
 */

export const TASK_NOT_FOUND = "TASK_NOT_FOUND" as const;
export const INVALID_RECURRENCE_RULE = "INVALID_RECURRENCE_RULE" as const;
export const TEMPLATE_NOT_FOUND = "TEMPLATE_NOT_FOUND" as const;
export const INVALID_LIMIT = "INVALID_LIMIT" as const;
export const INVALID_CURSOR = "INVALID_CURSOR" as const;

/**
 * No task with the given id exists in the tenant. Wire: 404
 * `{ error: "TASK_NOT_FOUND" }`.
 */
export class TaskNotFoundError extends Error {
  readonly code = TASK_NOT_FOUND;
  readonly taskId: string;
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
    this.taskId = taskId;
  }
}

/**
 * `recurrenceRule` field on a create payload could not be parsed by
 * `expandRule`. Wire: 400 `{ error: "INVALID_RECURRENCE_RULE" }`.
 */
export class InvalidRecurrenceRuleError extends Error {
  readonly code = INVALID_RECURRENCE_RULE;
  readonly received: string;
  constructor(received: string) {
    super(`Invalid recurrence rule: ${received}`);
    this.name = "InvalidRecurrenceRuleError";
    this.received = received;
  }
}

/**
 * `templateId` was supplied on a create payload but no row exists.
 * Wire: 400 `{ error: "TEMPLATE_NOT_FOUND" }` (NOT 404 — see module
 * docstring).
 */
export class TemplateNotFoundError extends Error {
  readonly code = TEMPLATE_NOT_FOUND;
  readonly templateId: string;
  constructor(templateId: string) {
    super(`Template not found: ${templateId}`);
    this.name = "TemplateNotFoundError";
    this.templateId = templateId;
  }
}

/**
 * `limit` query-param is not a positive finite integer. Wire: 400
 * `{ error: "INVALID_LIMIT" }`.
 */
export class InvalidLimitError extends Error {
  readonly code = INVALID_LIMIT;
  readonly received: string;
  constructor(received: string) {
    super(`Invalid limit: ${received}`);
    this.name = "InvalidLimitError";
    this.received = received;
  }
}

/**
 * Opaque pagination `cursor` query-param failed to decode. Wire: 400
 * `{ error: "INVALID_CURSOR" }`.
 */
export class InvalidCursorError extends Error {
  readonly code = INVALID_CURSOR;
  readonly received: string;
  constructor(received: string) {
    super(`Invalid cursor: ${received}`);
    this.name = "InvalidCursorError";
    this.received = received;
  }
}
