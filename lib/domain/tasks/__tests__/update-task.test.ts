/**
 * @vitest-environment node
 *
 * Wave E (#161) — domain op: `updateTask`.
 *
 * Updates a task row from a partial input. Allow-list field copy
 * (mirrors the pre-Wave-E PATCH route's `update[k] = data[k]` block).
 *
 * Phase K observation-on-completion contract is preserved:
 *
 *  - Status flips to "completed" with valid completionPayload →
 *    `$transaction` runs animal lookup (denormalised species) →
 *    observation create → task update with `completedObservationId`.
 *    Returns `{ ...task, observationCreated: true, observationId }`.
 *
 *  - Status flips to "completed" with payload but
 *    `observationFromTaskCompletion` returns null (e.g. weighing payload
 *    without weightKg, or maintenance taskType) → standard update,
 *    `observationCreated: false`. Silent null is intentional.
 *
 *  - Status flips to "completed" with no payload → standard update with
 *    auto-set `completedAt`, `observationCreated: false`.
 *
 *  - Re-open from "completed" → `completedAt: null`.
 *
 *  - Bad id → `TaskNotFoundError`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { updateTask } from "../update-task";
import { TaskNotFoundError } from "../errors";

const BASE_TASK = {
  id: "task-1",
  title: "Weigh cattle",
  dueDate: "2026-04-20",
  assignedTo: "worker@farm.com",
  createdBy: "admin@farm.com",
  status: "pending",
  priority: "normal",
  taskType: "weighing",
  lat: null,
  lng: null,
  campId: "camp-north",
  animalId: "animal-1",
  recurrenceRule: null,
  reminderOffset: null,
  assigneeIds: null,
  templateId: null,
  blockedByIds: null,
  completedObservationId: null,
  recurrenceSource: null,
  completedAt: null,
  createdAt: new Date(),
};

describe("updateTask(prisma, id, input, completionPayload?)", () => {
  const findUnique = vi.fn();
  const update = vi.fn();
  const observationCreate = vi.fn();
  const animalFindUnique = vi.fn();
  const $transaction = vi.fn();
  const prisma = {
    task: { findUnique, update },
    observation: { create: observationCreate },
    animal: { findUnique: animalFindUnique },
    $transaction,
  } as unknown as PrismaClient;

  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    observationCreate.mockReset();
    animalFindUnique.mockReset();
    $transaction.mockReset();
    findUnique.mockResolvedValue({ ...BASE_TASK });
    // $transaction by default runs the callback with `prisma` as the tx client
    // so the inner ops resolve through the same mock vi.fns.
    $transaction.mockImplementation(
      (fn: (tx: PrismaClient) => unknown) => fn(prisma),
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // a) No status change → standard update, observationCreated: false
  // ─────────────────────────────────────────────────────────────────────
  it("performs a standard update when no status change", async () => {
    update.mockResolvedValueOnce({ ...BASE_TASK, title: "New title" });

    const result = await updateTask(prisma, "task-1", { title: "New title" });

    expect(result.observationCreated).toBe(false);
    expect(result.observationId).toBeUndefined();
    expect(update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { title: "New title" },
    });
    expect($transaction).not.toHaveBeenCalled();
    expect(observationCreate).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────
  // b) Status flips to completed with no completionPayload → auto-set
  //    completedAt, observationCreated: false
  // ─────────────────────────────────────────────────────────────────────
  it("auto-sets completedAt on completion-without-payload", async () => {
    update.mockResolvedValueOnce({
      ...BASE_TASK,
      status: "completed",
      completedAt: "2026-04-20T10:00:00Z",
    });

    const result = await updateTask(prisma, "task-1", { status: "completed" });

    expect(result.observationCreated).toBe(false);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe("completed");
    expect(typeof data.completedAt).toBe("string");
    expect($transaction).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────
  // c) Status flips to completed with completionPayload but
  //    observationFromTaskCompletion returns null → standard update,
  //    observationCreated: false (silent null is intentional)
  // ─────────────────────────────────────────────────────────────────────
  it("falls through to standard update when payload yields null mapping", async () => {
    // weighing taskType but payload missing weightKg → null mapping
    update.mockResolvedValueOnce({
      ...BASE_TASK,
      status: "completed",
      completedAt: "2026-04-20T10:00:00Z",
    });

    const result = await updateTask(
      prisma,
      "task-1",
      { status: "completed" },
      { notes: "done but no weight" },
    );

    expect(result.observationCreated).toBe(false);
    expect(observationCreate).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────
  // d) Status flips to completed with valid completionPayload →
  //    $transaction runs: animal lookup → observation create → task update
  // ─────────────────────────────────────────────────────────────────────
  it("runs $transaction creating observation + linking task on valid completion", async () => {
    animalFindUnique.mockResolvedValueOnce({ species: "cattle" });
    observationCreate.mockResolvedValueOnce({ id: "obs-new" });
    update.mockResolvedValueOnce({
      ...BASE_TASK,
      status: "completed",
      completedObservationId: "obs-new",
    });

    const result = await updateTask(
      prisma,
      "task-1",
      { status: "completed" },
      { weightKg: 350 },
    );

    expect(result.observationCreated).toBe(true);
    expect(result.observationId).toBe("obs-new");
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(animalFindUnique).toHaveBeenCalledWith({
      where: { animalId: "animal-1" },
      select: { species: true },
    });
    expect(observationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "weighing",
          species: "cattle",
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task-1" },
        data: expect.objectContaining({
          completedObservationId: "obs-new",
        }),
      }),
    );
  });

  it("creates observation BEFORE task update (atomic ordering)", async () => {
    animalFindUnique.mockResolvedValueOnce({ species: "cattle" });
    observationCreate.mockResolvedValueOnce({ id: "obs-2" });
    update.mockResolvedValueOnce({ ...BASE_TASK });

    await updateTask(
      prisma,
      "task-1",
      { status: "completed" },
      { weightKg: 400 },
    );

    // call order: animal.findUnique → observation.create → task.update
    const animalCallOrder = animalFindUnique.mock.invocationCallOrder[0];
    const obsCallOrder = observationCreate.mock.invocationCallOrder[0];
    const taskUpdateCallOrder = update.mock.invocationCallOrder[0];

    expect(animalCallOrder).toBeLessThan(obsCallOrder);
    expect(obsCallOrder).toBeLessThan(taskUpdateCallOrder);
  });

  // ─────────────────────────────────────────────────────────────────────
  // e) Re-open from completed → completedAt cleared
  // ─────────────────────────────────────────────────────────────────────
  it("clears completedAt when re-opening a completed task", async () => {
    findUnique.mockResolvedValueOnce({
      ...BASE_TASK,
      status: "completed",
      completedAt: "2026-04-15T10:00:00Z",
    });
    update.mockResolvedValueOnce({ ...BASE_TASK, status: "in_progress" });

    await updateTask(prisma, "task-1", { status: "in_progress" });

    expect(update.mock.calls[0][0].data.completedAt).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────
  // f) Bad id → TaskNotFoundError
  // ─────────────────────────────────────────────────────────────────────
  it("throws TaskNotFoundError when the task does not exist", async () => {
    findUnique.mockResolvedValueOnce(null);

    await expect(updateTask(prisma, "missing", {})).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  // ── allow-list / shape ──
  it("only writes allow-listed fields", async () => {
    update.mockResolvedValueOnce({ ...BASE_TASK });

    // Cast through `unknown` to smuggle a junk field past UpdateTaskInput
    // — the test's whole point is that the op's allow-list copy strips it.
    await updateTask(prisma, "task-1", {
      title: "New title",
      description: "Note",
      dueDate: "2026-05-01",
      assignedTo: "x@y.com",
      junkField: "should not survive",
    } as unknown as Parameters<typeof updateTask>[2]);

    const data = update.mock.calls[0][0].data;
    expect(data.title).toBe("New title");
    expect(data.description).toBe("Note");
    expect(data.dueDate).toBe("2026-05-01");
    expect(data.assignedTo).toBe("x@y.com");
    expect(data.junkField).toBeUndefined();
  });

  it("rejects status values outside the allowed set", async () => {
    update.mockResolvedValueOnce({ ...BASE_TASK });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateTask(prisma, "task-1", { status: "bogus" as any });

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
  });

  it("rejects priority values outside the allowed set", async () => {
    update.mockResolvedValueOnce({ ...BASE_TASK });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateTask(prisma, "task-1", { priority: "extreme" as any });

    const data = update.mock.calls[0][0].data;
    expect(data.priority).toBeUndefined();
  });

  it("returns parsed assigneeIds in the result row", async () => {
    update.mockResolvedValueOnce({
      ...BASE_TASK,
      assigneeIds: JSON.stringify(["a@x.com"]),
      blockedByIds: JSON.stringify(["task-3"]),
    });

    const result = await updateTask(prisma, "task-1", { title: "x" });

    expect(result.assigneeIds).toEqual(["a@x.com"]);
    expect(result.blockedByIds).toEqual(["task-3"]);
  });

  it("does not auto-set completedAt when already completed (no transition)", async () => {
    findUnique.mockResolvedValueOnce({
      ...BASE_TASK,
      status: "completed",
      completedAt: "2026-04-15T10:00:00Z",
    });
    update.mockResolvedValueOnce({ ...BASE_TASK });

    // Re-applying status: completed should not clear completedAt
    await updateTask(prisma, "task-1", { status: "completed" });

    const data = update.mock.calls[0][0].data;
    // existing completedAt + no new payload → completedAt should stay untouched
    expect(data.completedAt).toBeUndefined();
  });

  it("does not run observation transaction when status was already completed", async () => {
    findUnique.mockResolvedValueOnce({
      ...BASE_TASK,
      status: "completed",
      completedAt: "2026-04-15T10:00:00Z",
    });
    update.mockResolvedValueOnce({ ...BASE_TASK });

    await updateTask(
      prisma,
      "task-1",
      { status: "completed" },
      { weightKg: 350 },
    );

    expect($transaction).not.toHaveBeenCalled();
    expect(observationCreate).not.toHaveBeenCalled();
  });
});
