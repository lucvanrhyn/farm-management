// lib/server/nudges/task-dedup.ts — "already scheduled" suppression.
//
// Proactive Nudges v1 (#nudges) — a nudge's "add as task" (do-later) creates a
// pending Task. On the NEXT feed render we must not re-prompt for a task the
// farmer already scheduled. This module answers "is there already a pending
// task for this action's target?" so the feed can show an "already scheduled"
// marker instead of a duplicate action button.
//
// It queries pending Tasks via the canonical `listTasksUnbounded` op
// (lib/domain/tasks/list-tasks.ts) filtered by taskType + the action's scope id
// (campId or animalId). Task is NOT a species model, so this is a plain
// tenant-scoped read (no scoped()/crossSpecies() door needed).
//
// Resilient: a query failure returns `false` (show the action) rather than
// throwing — a transient DB hiccup must never blank the do-next feed.

import type { PrismaClient } from "@prisma/client";
import type { RecommendedAction } from "@/lib/server/alerts";
import { listTasksUnbounded } from "@/lib/domain/tasks/list-tasks";

/**
 * True iff a pending Task already exists for this action's target
 * (taskType + campId/animalId). Returns false when the action has no usable
 * target id, or when the query fails.
 */
export async function isActionAlreadyScheduled(
  prisma: PrismaClient,
  action: RecommendedAction,
): Promise<boolean> {
  const { campId, animalId, waterPointId } = action.target;
  // IT3 / farm-wide actions have no per-entity target id — nothing to dedup on.
  if (!campId && !animalId && !waterPointId) return false;

  try {
    const tasks = await listTasksUnbounded(prisma, {
      status: "pending",
      taskType: action.taskType,
      ...(campId ? { campId } : {}),
    });
    // `listTasksUnbounded` filters campId in the where clause but not animalId or
    // waterPointId (no such filters on ListTasksFilters), so for those targets we
    // match in memory on the returned pending+taskType set. Matching waterPointId
    // exactly is what keeps two boreholes in one camp from colliding.
    if (waterPointId) {
      return tasks.some((t) => t.waterPointId === waterPointId);
    }
    if (animalId) {
      return tasks.some((t) => t.animalId === animalId);
    }
    return tasks.length > 0;
  } catch {
    return false;
  }
}
