/**
 * @vitest-environment node
 *
 * Wave E (#161) — domain op: `deleteTask`.
 *
 * Removes a task row by id. Pre-checks existence with `findUnique`
 * (matches the pre-Wave-E DELETE route's contract) and throws
 * `TaskNotFoundError` so the adapter envelope mints a 404
 * `{ error: "TASK_NOT_FOUND" }`.
 *
 * Returns `{ success: true }` (preserved verbatim — admin /tasks UI,
 * offline-sync queue, and Inngest task-cleanup workers all compare
 * against this exact shape).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { deleteTask } from "../delete-task";
import { TaskNotFoundError } from "../errors";

describe("deleteTask(prisma, id)", () => {
  const findUnique = vi.fn();
  const del = vi.fn();
  const prisma = {
    task: { findUnique, delete: del },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findUnique.mockReset();
    del.mockReset();
  });

  it("throws TaskNotFoundError when the row does not exist", async () => {
    findUnique.mockResolvedValue(null);

    await expect(deleteTask(prisma, "missing")).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes the row and returns { success: true } when it exists", async () => {
    findUnique.mockResolvedValue({ id: "task-1" });
    del.mockResolvedValue({ id: "task-1" });

    const result = await deleteTask(prisma, "task-1");

    expect(result).toEqual({ success: true });
    expect(del).toHaveBeenCalledWith({ where: { id: "task-1" } });
  });
});
