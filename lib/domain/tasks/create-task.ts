/**
 * Wave E (#161) — domain op `createTask`.
 *
 * Persists a new task row. Required-shape validation
 * (`title`, `dueDate`, `assignedTo`) is enforced at the route layer via
 * the schema parser, mirroring Wave D's precedent — the op trusts those
 * three are present and only enforces business rules:
 *
 *  1. Recurrence-rule dry-run validation — `expandRule(...)` is called
 *     with an empty context + 1-day horizon to catch malformed rules
 *     before we touch the DB. A throw escalates to
 *     `InvalidRecurrenceRuleError` (typed, 400).
 *  2. Optional template lookup — when `templateId` is set, the row must
 *     exist; otherwise `TemplateNotFoundError` (typed, 400 — see errors
 *     module docstring on why it's 400 not 404).
 *  3. Field merge — explicit `taskType` / `recurrenceRule` /
 *     `reminderOffset` win over template defaults; template values fill
 *     the gap when the explicit field is absent.
 *
 * `assigneeIds` and `blockedByIds` arrive as `string[] | undefined` from
 * the route layer; they round-trip JSON-stringified for SQLite storage
 * (the DB column is TEXT). The wire shape stays "parsed array" — the
 * `parseTaskArrayFields` helper from `list-tasks.ts` re-parses on the
 * way out.
 */
import type { PrismaClient } from "@prisma/client";

import { expandRule } from "@/lib/tasks/recurrence";

import {
  InvalidRecurrenceRuleError,
  TemplateNotFoundError,
} from "./errors";
import { parseTaskArrayFields } from "./list-tasks";

export interface CreateTaskInput {
  title: string;
  dueDate: string;
  assignedTo: string;
  /** Email/name of the actor — captured on the audit trail. */
  createdBy: string;
  description?: string | null;
  status?: string;
  priority?: string;
  campId?: string | null;
  animalId?: string | null;
  taskType?: string | null;
  lat?: number | null;
  lng?: number | null;
  recurrenceRule?: string | null;
  reminderOffset?: number | null;
  assigneeIds?: string[] | null;
  templateId?: string | null;
  blockedByIds?: string[] | null;
  recurrenceSource?: string | null;
}

export async function createTask(
  prisma: PrismaClient,
  input: CreateTaskInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  // ── Validate recurrenceRule early (before DB write) ──
  if (typeof input.recurrenceRule === "string" && input.recurrenceRule.trim() !== "") {
    try {
      // Dry-run validation: expand with an empty context, 1-day horizon.
      // This will throw UNKNOWN_RECURRENCE_RULE for malformed rules.
      expandRule(input.recurrenceRule, new Date(), 1, {
        events: [],
        seasonWindows: {},
      });
    } catch {
      throw new InvalidRecurrenceRuleError(input.recurrenceRule);
    }
  }

  // ── Load template if provided ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let templateDefaults: Record<string, any> = {};
  if (typeof input.templateId === "string" && input.templateId) {
    const tmpl = await prisma.taskTemplate.findUnique({
      where: { id: input.templateId },
    });
    if (!tmpl) {
      throw new TemplateNotFoundError(input.templateId);
    }
    templateDefaults = {
      taskType: tmpl.taskType,
      recurrenceRule: tmpl.recurrenceRule,
      reminderOffset: tmpl.reminderOffset,
    };
  }

  // ── Merge: explicit fields override template defaults ──
  const resolvedTaskType =
    typeof input.taskType === "string" ? input.taskType : templateDefaults.taskType ?? null;
  const resolvedRecurrenceRule =
    typeof input.recurrenceRule === "string" && input.recurrenceRule.trim()
      ? input.recurrenceRule
      : templateDefaults.recurrenceRule ?? null;
  const resolvedReminderOffset =
    typeof input.reminderOffset === "number"
      ? input.reminderOffset
      : templateDefaults.reminderOffset ?? null;

  // Serialize array fields for SQLite storage
  const assigneeIds =
    Array.isArray(input.assigneeIds) ? JSON.stringify(input.assigneeIds) : null;
  const blockedByIds =
    Array.isArray(input.blockedByIds) ? JSON.stringify(input.blockedByIds) : null;

  const task = await prisma.task.create({
    data: {
      title: input.title.trim(),
      description: typeof input.description === "string" ? input.description : null,
      dueDate: input.dueDate,
      assignedTo: input.assignedTo,
      createdBy: input.createdBy,
      status: typeof input.status === "string" ? input.status : "pending",
      priority: typeof input.priority === "string" ? input.priority : "normal",
      campId: typeof input.campId === "string" && input.campId ? input.campId : null,
      animalId:
        typeof input.animalId === "string" && input.animalId ? input.animalId : null,
      // Phase K new fields
      taskType: resolvedTaskType,
      lat: typeof input.lat === "number" ? input.lat : null,
      lng: typeof input.lng === "number" ? input.lng : null,
      recurrenceRule: resolvedRecurrenceRule,
      reminderOffset: resolvedReminderOffset,
      assigneeIds,
      templateId:
        typeof input.templateId === "string" && input.templateId ? input.templateId : null,
      blockedByIds,
      completedObservationId: null,
      recurrenceSource:
        typeof input.recurrenceSource === "string" ? input.recurrenceSource : null,
    },
  });

  return parseTaskArrayFields(task);
}
