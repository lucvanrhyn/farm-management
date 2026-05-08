/**
 * Wave E (#161) — domain op `deleteTask`.
 *
 * Removes a task row by id after a `findUnique` existence pre-check
 * (matches the pre-Wave-E DELETE route's contract). Throws
 * `TaskNotFoundError` when the row does not exist so the adapter
 * envelope mints a 404 `{ error: "TASK_NOT_FOUND" }`.
 *
 * Returns `{ success: true }` — preserved verbatim from the legacy wire
 * shape so admin /tasks UI + offline-sync queue stay compatible.
 */
import type { PrismaClient } from "@prisma/client";

import { TaskNotFoundError } from "./errors";

export interface DeleteTaskResult {
  success: true;
}

export async function deleteTask(
  prisma: PrismaClient,
  id: string,
): Promise<DeleteTaskResult> {
  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) {
    throw new TaskNotFoundError(id);
  }

  await prisma.task.delete({ where: { id } });

  return { success: true };
}
