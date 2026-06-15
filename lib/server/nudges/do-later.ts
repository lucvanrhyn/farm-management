// lib/server/nudges/do-later.ts — "add as task" (do-later) input builder.
//
// Proactive Nudges v1 (#nudges) — decision 7. A nudge offers three responses:
//   - accept    → CLIENT navigation to the prefilled form (no server write),
//   - do-later  → create a PENDING Task from the action (THIS module),
//   - dismiss   → mark the notification read (existing /api/notifications route).
//
// do-later is ONLINE-ONLY: there is no `task` SyncKind, so it goes through
// POST /api/tasks (adminWrite) → createTask. This module is the pure mapper from
// a RecommendedAction (+ the originating nudge type) to a CreateTaskInput; the
// route owns the actual createTask call + envelope. `recurrenceSource` is
// stamped `nudge:<type>` so a do-later task is traceable to the nudge that
// spawned it (and so task-dedup can later recognise it as scheduled).

import type { RecommendedAction } from "@/lib/server/alerts";
import type { CreateTaskInput } from "@/lib/domain/tasks/create-task";

export interface DoLaterContext {
  /** Email/name of the actor — assignee + audit trail. */
  createdBy: string;
  now?: Date;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build the CreateTaskInput for a do-later action. The task is `pending`, due
 * today, assigned to the actor, scoped to the action's target (campId or
 * animalId), and tagged `recurrenceSource: nudge:<nudgeType>`.
 */
export function buildNudgeTaskInput(
  action: RecommendedAction,
  nudgeType: string,
  ctx: DoLaterContext,
): CreateTaskInput {
  const now = ctx.now ?? new Date();
  const { campId, animalId } = action.target;

  return {
    title: action.label,
    dueDate: toIsoDate(now),
    assignedTo: ctx.createdBy,
    createdBy: ctx.createdBy,
    status: "pending",
    taskType: action.taskType,
    ...(campId ? { campId } : {}),
    ...(animalId ? { animalId } : {}),
    recurrenceSource: `nudge:${nudgeType}`,
  };
}
