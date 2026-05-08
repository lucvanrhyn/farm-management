/**
 * @vitest-environment node
 *
 * Wave E (#161) — domain op: `createTask`.
 *
 * Persists a task row after:
 *   1. Recurrence-rule dry-run validation (`expandRule` from
 *      `lib/tasks/recurrence` — throws `InvalidRecurrenceRuleError`).
 *   2. Optional template lookup (templateId → throws
 *      `TemplateNotFoundError` when row missing).
 *   3. Merge of explicit fields over template defaults.
 *
 * Required-shape validation (title / dueDate / assignedTo) is enforced
 * at the route layer via the schema parser — the op trusts those three
 * are present and only enforces business rules.
 *
 * Wire shape returns the parsed task row (assigneeIds + blockedByIds as
 * proper arrays).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { createTask } from "../create-task";
import {
  InvalidRecurrenceRuleError,
  TemplateNotFoundError,
} from "../errors";

const TASK_ROW = {
  id: "task-new",
  title: "Weigh cattle",
  dueDate: "2026-04-20",
  assignedTo: "worker@farm.com",
  createdBy: "admin@farm.com",
  status: "pending",
  priority: "normal",
  taskType: "weighing",
  lat: null,
  lng: null,
  campId: null,
  animalId: null,
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

describe("createTask(prisma, input)", () => {
  const create = vi.fn();
  const findUnique = vi.fn();
  const prisma = {
    task: { create },
    taskTemplate: { findUnique },
  } as unknown as PrismaClient;

  beforeEach(() => {
    create.mockReset();
    findUnique.mockReset();
    create.mockResolvedValue(TASK_ROW);
  });

  it("creates a task with minimal required fields and returns parsed row", async () => {
    const result = await createTask(prisma, {
      title: "Weigh cattle",
      dueDate: "2026-04-20",
      assignedTo: "worker@farm.com",
      createdBy: "admin@farm.com",
    });

    expect(result.id).toBe("task-new");
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Weigh cattle",
        dueDate: "2026-04-20",
        assignedTo: "worker@farm.com",
        createdBy: "admin@farm.com",
        status: "pending",
        priority: "normal",
      }),
    });
  });

  it("throws InvalidRecurrenceRuleError on malformed recurrence rule", async () => {
    await expect(
      createTask(prisma, {
        title: "Bad rule task",
        dueDate: "2026-04-20",
        assignedTo: "worker@farm.com",
        createdBy: "admin@farm.com",
        recurrenceRule: "totally-bogus-rule!!",
      }),
    ).rejects.toBeInstanceOf(InvalidRecurrenceRuleError);
    expect(create).not.toHaveBeenCalled();
  });

  it("throws InvalidRecurrenceRuleError for after: shortcut with bad syntax", async () => {
    await expect(
      createTask(prisma, {
        title: "Bad shortcut",
        dueDate: "2026-04-20",
        assignedTo: "worker@farm.com",
        createdBy: "admin@farm.com",
        recurrenceRule: "after:calving+21", // missing 'd'
      }),
    ).rejects.toBeInstanceOf(InvalidRecurrenceRuleError);
  });

  it("accepts a valid RRULE string", async () => {
    await createTask(prisma, {
      title: "Weekly dip",
      dueDate: "2026-04-20",
      assignedTo: "worker@farm.com",
      createdBy: "admin@farm.com",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
        }),
      }),
    );
  });

  it("throws TemplateNotFoundError when templateId is provided but not found", async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      createTask(prisma, {
        title: "From template",
        dueDate: "2026-04-20",
        assignedTo: "worker@farm.com",
        createdBy: "admin@farm.com",
        templateId: "missing-template",
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
    expect(create).not.toHaveBeenCalled();
  });

  it("merges template defaults under explicit fields", async () => {
    findUnique.mockResolvedValue({
      id: "tmpl-1",
      taskType: "dipping",
      recurrenceRule: "FREQ=WEEKLY",
      reminderOffset: 60,
    });

    await createTask(prisma, {
      title: "Custom dip",
      dueDate: "2026-04-20",
      assignedTo: "worker@farm.com",
      createdBy: "admin@farm.com",
      templateId: "tmpl-1",
      // explicit override of taskType — wins over template default
      taskType: "treatment",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          // explicit override
          taskType: "treatment",
          // pulled from template
          recurrenceRule: "FREQ=WEEKLY",
          reminderOffset: 60,
          templateId: "tmpl-1",
        }),
      }),
    );
  });

  it("uses template fields when explicit ones are absent", async () => {
    findUnique.mockResolvedValue({
      id: "tmpl-1",
      taskType: "dipping",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      reminderOffset: 30,
    });

    await createTask(prisma, {
      title: "Template-driven task",
      dueDate: "2026-04-20",
      assignedTo: "worker@farm.com",
      createdBy: "admin@farm.com",
      templateId: "tmpl-1",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskType: "dipping",
          recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
          reminderOffset: 30,
        }),
      }),
    );
  });

  it("JSON-stringifies assigneeIds and blockedByIds for SQLite storage", async () => {
    await createTask(prisma, {
      title: "Multi-person task",
      dueDate: "2026-04-20",
      assignedTo: "worker@farm.com",
      createdBy: "admin@farm.com",
      assigneeIds: ["worker1@farm.com", "worker2@farm.com"],
      blockedByIds: ["task-1"],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeIds: JSON.stringify(["worker1@farm.com", "worker2@farm.com"]),
          blockedByIds: JSON.stringify(["task-1"]),
        }),
      }),
    );
  });

  it("nulls assigneeIds/blockedByIds when input arrays are absent", async () => {
    await createTask(prisma, {
      title: "Single",
      dueDate: "2026-04-20",
      assignedTo: "worker@farm.com",
      createdBy: "admin@farm.com",
    });

    expect(create.mock.calls[0][0].data.assigneeIds).toBeNull();
    expect(create.mock.calls[0][0].data.blockedByIds).toBeNull();
  });

  it("returns parsed assigneeIds in the result row", async () => {
    create.mockResolvedValueOnce({
      ...TASK_ROW,
      assigneeIds: JSON.stringify(["a@x.com"]),
      blockedByIds: JSON.stringify(["task-2"]),
    });

    const result = await createTask(prisma, {
      title: "Multi",
      dueDate: "2026-04-20",
      assignedTo: "worker@farm.com",
      createdBy: "admin@farm.com",
      assigneeIds: ["a@x.com"],
      blockedByIds: ["task-2"],
    });

    expect(result.assigneeIds).toEqual(["a@x.com"]);
    expect(result.blockedByIds).toEqual(["task-2"]);
  });

  it("preserves null/undefined optional fields", async () => {
    await createTask(prisma, {
      title: "Plain",
      dueDate: "2026-04-20",
      assignedTo: "worker@farm.com",
      createdBy: "admin@farm.com",
    });

    const data = create.mock.calls[0][0].data;
    expect(data.campId).toBeNull();
    expect(data.animalId).toBeNull();
    expect(data.lat).toBeNull();
    expect(data.lng).toBeNull();
    expect(data.recurrenceRule).toBeNull();
    expect(data.reminderOffset).toBeNull();
    expect(data.templateId).toBeNull();
    expect(data.completedObservationId).toBeNull();
    expect(data.recurrenceSource).toBeNull();
  });
});
