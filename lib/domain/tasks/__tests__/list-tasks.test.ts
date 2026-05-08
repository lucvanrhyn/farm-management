/**
 * @vitest-environment node
 *
 * Wave E (#161) — domain ops: `listTasksUnbounded`, `listTasksPaginated`,
 * `listTaskOccurrences`.
 *
 * Three exported functions keep the route's three GET modes type-safe at
 * the call site:
 *
 *  - `listTasksUnbounded(prisma, filters)` — back-compat array shape used
 *    by the offline-sync queue + logger fetch.
 *  - `listTasksPaginated(prisma, args)` — `{ tasks, nextCursor, hasMore }`
 *    shape used by the admin /tasks SSR page + "Load more" control.
 *    Throws `InvalidLimitError` / `InvalidCursorError` on bad inputs.
 *  - `listTaskOccurrences(prisma, { from, to })` — TaskOccurrence[] for a
 *    given window, with included `task`.
 *
 * Wire shape (parsed `assigneeIds` + `blockedByIds` arrays) is preserved
 * verbatim — admin UI + IndexedDB sync compare against this exact shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  listTasksUnbounded,
  listTasksPaginated,
  listTaskOccurrences,
} from "../list-tasks";
import { InvalidCursorError, InvalidLimitError } from "../errors";
import { encodeTaskCursor } from "@/lib/tasks/cursor";

const TASK_ROW = {
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
  createdAt: new Date("2026-04-01T00:00:00Z"),
};

describe("listTasksUnbounded(prisma, filters)", () => {
  const findMany = vi.fn();
  const prisma = {
    task: { findMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findMany.mockReset();
  });

  it("returns parsed tasks with no filters", async () => {
    findMany.mockResolvedValue([TASK_ROW]);

    const result = await listTasksUnbounded(prisma, {});

    expect(Array.isArray(result)).toBe(true);
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [
        { dueDate: "asc" },
        { priority: "asc" },
        { createdAt: "asc" },
      ],
    });
  });

  it("translates assignee + status filters into a Prisma where clause", async () => {
    findMany.mockResolvedValue([]);

    await listTasksUnbounded(prisma, {
      assignee: "worker@farm.com",
      status: "pending",
      campId: "camp-A",
      taskType: "weighing",
      date: "2026-04-20",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        assignedTo: "worker@farm.com",
        status: "pending",
        dueDate: "2026-04-20",
        campId: "camp-A",
        taskType: "weighing",
      },
      orderBy: [
        { dueDate: "asc" },
        { priority: "asc" },
        { createdAt: "asc" },
      ],
    });
  });

  it("splits comma-separated status into a Prisma `in` clause", async () => {
    findMany.mockResolvedValue([]);

    await listTasksUnbounded(prisma, { status: "pending,in_progress" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["pending", "in_progress"] } },
      }),
    );
  });

  it("translates geo bbox into lat/lng range filters", async () => {
    findMany.mockResolvedValue([]);

    await listTasksUnbounded(prisma, {
      geo: { lat: -30, lng: 25, radiusKm: 11.1 },
    });

    const call = findMany.mock.calls[0][0];
    expect(call.where.lat).toBeDefined();
    expect(call.where.lng).toBeDefined();
    expect(call.where.lat.gte).toBeCloseTo(-30 - 0.1, 5);
    expect(call.where.lat.lte).toBeCloseTo(-30 + 0.1, 5);
  });

  it("parses assigneeIds + blockedByIds JSON-stringified arrays", async () => {
    findMany.mockResolvedValue([
      {
        ...TASK_ROW,
        assigneeIds: JSON.stringify(["a@x.com", "b@x.com"]),
        blockedByIds: JSON.stringify(["task-2"]),
      },
    ]);

    const result = await listTasksUnbounded(prisma, {});

    expect(result[0].assigneeIds).toEqual(["a@x.com", "b@x.com"]);
    expect(result[0].blockedByIds).toEqual(["task-2"]);
  });

  it("returns null for assigneeIds when DB row stores null", async () => {
    findMany.mockResolvedValue([{ ...TASK_ROW, assigneeIds: null }]);

    const result = await listTasksUnbounded(prisma, {});

    expect(result[0].assigneeIds).toBeNull();
  });
});

describe("listTasksPaginated(prisma, args)", () => {
  const findMany = vi.fn();
  const prisma = {
    task: { findMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findMany.mockReset();
  });

  it("throws InvalidLimitError on non-finite limit", async () => {
    await expect(
      listTasksPaginated(prisma, { filters: {}, limit: NaN }),
    ).rejects.toBeInstanceOf(InvalidLimitError);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("throws InvalidLimitError on zero / negative limit", async () => {
    await expect(
      listTasksPaginated(prisma, { filters: {}, limit: 0 }),
    ).rejects.toBeInstanceOf(InvalidLimitError);
    await expect(
      listTasksPaginated(prisma, { filters: {}, limit: -3 }),
    ).rejects.toBeInstanceOf(InvalidLimitError);
  });

  it("throws InvalidCursorError on undecodable cursor", async () => {
    await expect(
      listTasksPaginated(prisma, {
        filters: {},
        limit: 50,
        cursor: "not-a-valid-cursor",
      }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns hasMore=false and nextCursor=null when fewer than limit rows match", async () => {
    findMany.mockResolvedValue([TASK_ROW]);

    const result = await listTasksPaginated(prisma, {
      filters: {},
      limit: 50,
    });

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.tasks).toHaveLength(1);
  });

  it("returns hasMore=true and a nextCursor when limit+1 rows match", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      ...TASK_ROW,
      id: `task-${i + 1}`,
      dueDate: `2026-04-${String(i + 1).padStart(2, "0")}`,
    }));
    findMany.mockResolvedValue(rows);

    const result = await listTasksPaginated(prisma, {
      filters: {},
      limit: 2,
    });

    expect(result.hasMore).toBe(true);
    expect(result.tasks).toHaveLength(2);
    expect(typeof result.nextCursor).toBe("string");
  });

  it("uses TASK_CURSOR_ORDER_BY and take=limit+1", async () => {
    findMany.mockResolvedValue([]);

    await listTasksPaginated(prisma, { filters: {}, limit: 25 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { dueDate: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        take: 26,
      }),
    );
  });

  it("composes cursor where clause when cursor supplied", async () => {
    findMany.mockResolvedValue([]);
    const cursor = encodeTaskCursor({
      dueDate: "2026-04-15",
      createdAt: "2026-04-15T00:00:00.000Z",
      id: "task-prev",
    });

    await listTasksPaginated(prisma, {
      filters: {},
      limit: 10,
      cursor,
    });

    const call = findMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
    expect(Array.isArray(call.where.OR)).toBe(true);
  });

  it("caps requested limit at MAX_LIMIT (500)", async () => {
    findMany.mockResolvedValue([]);

    await listTasksPaginated(prisma, { filters: {}, limit: 9999 });

    const call = findMany.mock.calls[0][0];
    // take = limit + 1 → max 501
    expect(call.take).toBe(501);
  });
});

describe("listTaskOccurrences(prisma, args)", () => {
  const findMany = vi.fn();
  const prisma = {
    taskOccurrence: { findMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findMany.mockReset();
  });

  it("queries occurrences with from/to range and includes task", async () => {
    findMany.mockResolvedValue([]);
    const from = new Date("2026-04-20T00:00:00Z");
    const to = new Date("2026-04-21T00:00:00Z");

    await listTaskOccurrences(prisma, { from, to });

    expect(findMany).toHaveBeenCalledWith({
      where: { occurrenceAt: { gte: from, lte: to } },
      include: { task: true },
      orderBy: { occurrenceAt: "asc" },
    });
  });
});
