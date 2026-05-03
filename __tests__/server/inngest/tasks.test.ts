/**
 * @vitest-environment node
 *
 * __tests__/server/inngest/tasks.test.ts — Phase K Wave 2B unit tests.
 *
 * Guarantees:
 *   1. regenerateForTenant calls upsert once per expandRule result.
 *   2. regenerateForTenant swallows P2002 (already-materialised occurrences)
 *      and continues, mirroring Phase J dedup.ts:213-239.
 *   3. dispatchRemindersForTenant stamps reminderDispatchedAt via updateMany
 *      BEFORE writing any Notification row (mark-before-send per Phase J
 *      dispatch.ts:117-121).
 *   4. dispatchRemindersForTenant writes exactly one Notification per stamped
 *      row, with dedupKey keyed on occurrence id.
 *
 * Wave 2A dependency: we vi.mock("@/lib/tasks/recurrence", ...) so these tests
 * stay runnable even if Wave 2A's module hasn't landed yet on the branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist the recurrence mock above the import so Vitest wires it correctly even
// if Wave 2A's real module hasn't landed yet.
vi.mock("@/lib/tasks/recurrence", () => ({
  expandRule: vi.fn(),
}));

// getPrismaForFarm + getAllFarmSlugs + inngest client are unused by the two
// pure functions we test directly. We only mock them defensively so importing
// tasks.ts doesn't try to connect to a real libsql instance.
vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: vi.fn().mockResolvedValue(null),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));
vi.mock("@/lib/meta-db", () => ({
  getAllFarmSlugs: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/server/inngest/client", () => ({
  inngest: {
    createFunction: (_opts: unknown, handler: unknown) => ({
      __handler: handler,
      opts: _opts,
    }),
  },
}));

import {
  regenerateForTenant,
  dispatchRemindersForTenant,
} from "@/lib/server/inngest/tasks";
import { expandRule } from "@/lib/tasks/recurrence";
import { makePrisma } from "../../alerts/fixtures";

function p2002(): Error {
  const err = new Error("Unique constraint failed") as Error & { code: string };
  err.code = "P2002";
  return err;
}

describe("regenerateForTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates one TaskOccurrence per date returned by expandRule", async () => {
    (expandRule as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      new Date("2026-05-01T09:00:00Z"),
      new Date("2026-05-08T09:00:00Z"),
      new Date("2026-05-15T09:00:00Z"),
    ]);

    const taskRow = {
      id: "task-1",
      animalId: null,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=FR",
      reminderOffset: 60, // 60 minutes before
    };
    const taskFindMany = vi.fn().mockResolvedValue([taskRow]);
    const occCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: `occ-${Math.random()}`, ...data }),
    );
    const occDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

    const prisma = makePrisma({
      task: { findMany: taskFindMany },
      taskOccurrence: {
        create: occCreate,
        deleteMany: occDeleteMany,
      },
      farmSettings: {
        findFirst: vi.fn().mockResolvedValue({ breedingSeasonStart: null, breedingSeasonEnd: null }),
      },
    });

    const result = await regenerateForTenant(prisma);

    expect(occCreate).toHaveBeenCalledTimes(3);
    // reminderAt should be 60 minutes before occurrenceAt on every write.
    for (const call of occCreate.mock.calls) {
      const { occurrenceAt, reminderAt } = call[0].data as {
        occurrenceAt: Date;
        reminderAt: Date;
      };
      expect(reminderAt.getTime()).toBe(occurrenceAt.getTime() - 60 * 60_000);
    }
    expect(result).toEqual({
      taskCount: 1,
      occurrencesCreated: 3,
      occurrencesSkipped: 0,
      horizonPurged: 0,
    });
  });

  it("swallows P2002 when an occurrence is already materialised and continues", async () => {
    (expandRule as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      new Date("2026-05-01T09:00:00Z"),
      new Date("2026-05-08T09:00:00Z"),
    ]);

    const taskFindMany = vi.fn().mockResolvedValue([
      {
        id: "task-1",
        animalId: null,
        recurrenceRule: "FREQ=WEEKLY",
        reminderOffset: null,
      },
    ]);
    // First create succeeds, second throws P2002 (already exists).
    const occCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: "occ-1" })
      .mockRejectedValueOnce(p2002());
    const occDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

    const prisma = makePrisma({
      task: { findMany: taskFindMany },
      taskOccurrence: {
        create: occCreate,
        deleteMany: occDeleteMany,
      },
      farmSettings: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await regenerateForTenant(prisma);

    expect(occCreate).toHaveBeenCalledTimes(2);
    expect(result.occurrencesCreated).toBe(1);
    expect(result.occurrencesSkipped).toBe(1);
  });

  it("re-throws non-P2002 errors so the Inngest step retries", async () => {
    (expandRule as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      new Date("2026-05-01T09:00:00Z"),
    ]);
    const boom = new Error("connection reset");
    const occCreate = vi.fn().mockRejectedValue(boom);
    const prisma = makePrisma({
      task: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "task-1",
            animalId: null,
            recurrenceRule: "FREQ=DAILY",
            reminderOffset: null,
          },
        ]),
      },
      taskOccurrence: {
        create: occCreate,
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    await expect(regenerateForTenant(prisma)).rejects.toThrow("connection reset");
  });

  it("purges pending future occurrences beyond the 90-day horizon", async () => {
    (expandRule as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const occDeleteMany = vi.fn().mockResolvedValue({ count: 4 });
    const prisma = makePrisma({
      task: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "task-1",
            animalId: null,
            recurrenceRule: "FREQ=DAILY",
            reminderOffset: null,
          },
        ]),
      },
      taskOccurrence: {
        create: vi.fn(),
        deleteMany: occDeleteMany,
      },
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    const result = await regenerateForTenant(prisma);

    expect(occDeleteMany).toHaveBeenCalledTimes(1);
    const deleteArg = occDeleteMany.mock.calls[0][0];
    expect(deleteArg.where.status).toBe("pending");
    expect(deleteArg.where.taskId.in).toEqual(["task-1"]);
    // occurrenceAt cutoff must be roughly now + 90 days.
    const cutoff: Date = deleteArg.where.occurrenceAt.gt;
    const expectedApprox = Date.now() + 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedApprox)).toBeLessThan(5_000);
    expect(result.horizonPurged).toBe(4);
  });
});

describe("dispatchRemindersForTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stamps reminderDispatchedAt BEFORE writing any Notification row", async () => {
    const ready = [
      {
        id: "occ-1",
        occurrenceAt: new Date("2026-05-01T09:00:00Z"),
        reminderAt: new Date("2026-05-01T08:00:00Z"),
        reminderDispatchedAt: null,
        task: {
          id: "task-1",
          title: "Weigh weaners",
          assignedTo: "user-1",
          animalId: null,
          campId: "camp-1",
          taskType: "weighing",
          priority: "normal",
        },
      },
    ];

    const callOrder: string[] = [];
    const occFindMany = vi.fn().mockImplementation(() => {
      callOrder.push("findMany");
      return Promise.resolve(ready);
    });
    const occUpdateMany = vi.fn().mockImplementation(() => {
      callOrder.push("updateMany");
      return Promise.resolve({ count: 1 });
    });
    const notifCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      callOrder.push("notifCreate");
      return Promise.resolve({ id: "n-1", ...data });
    });

    // Subsequent findMany (re-read after stamping) returns the same row — in
    // real life the stamp would be applied; our mock is stateless so we just
    // return the ready set as-is with the stamp baked in.
    let findManyCalls = 0;
    const occFindManyStateful = vi.fn().mockImplementation(() => {
      findManyCalls++;
      callOrder.push(`findMany#${findManyCalls}`);
      return Promise.resolve(ready);
    });

    const prisma = makePrisma({
      taskOccurrence: {
        findMany: occFindManyStateful,
        updateMany: occUpdateMany,
      },
      notification: { create: notifCreate },
    });

    const result = await dispatchRemindersForTenant(prisma);

    // findMany#1 → updateMany → findMany#2 → notifCreate (stamp before send).
    expect(callOrder[0]).toBe("findMany#1");
    expect(callOrder[1]).toBe("updateMany");
    expect(callOrder[2]).toBe("findMany#2");
    expect(callOrder[3]).toBe("notifCreate");

    expect(occUpdateMany).toHaveBeenCalledTimes(1);
    const updateArg = occUpdateMany.mock.calls[0][0];
    expect(updateArg.where.reminderDispatchedAt).toBeNull();
    expect(updateArg.where.id.in).toEqual(["occ-1"]);
    expect(updateArg.data.reminderDispatchedAt).toBeInstanceOf(Date);

    expect(notifCreate).toHaveBeenCalledTimes(1);
    const notif = notifCreate.mock.calls[0][0].data;
    expect(notif.type).toBe("TASK_REMINDER");
    expect(notif.dedupKey).toBe("TASK_REMINDER:occ-1");
    expect(notif.collapseKey).toBe("task-reminder:occ-1");
    expect(notif.message).toContain("Weigh weaners");

    expect(result).toEqual({ ready: 1, dispatched: 1, raceSkipped: 0 });

    // Silence unused-var lints on the initial non-stateful mocks.
    void occFindMany;
  });

  it("writes exactly one Notification per row returned from the re-read", async () => {
    const ready = [
      {
        id: "occ-a",
        occurrenceAt: new Date(),
        reminderAt: new Date(),
        reminderDispatchedAt: null,
        task: { id: "t-a", title: "A", assignedTo: "u", animalId: null, campId: null, taskType: null, priority: "normal" },
      },
      {
        id: "occ-b",
        occurrenceAt: new Date(),
        reminderAt: new Date(),
        reminderDispatchedAt: null,
        task: { id: "t-b", title: "B", assignedTo: "u", animalId: null, campId: null, taskType: null, priority: "high" },
      },
    ];

    const notifCreate = vi.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: `n-${Math.random()}`, ...data }),
    );
    const prisma = makePrisma({
      taskOccurrence: {
        findMany: vi.fn().mockResolvedValue(ready),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      notification: { create: notifCreate },
    });

    const result = await dispatchRemindersForTenant(prisma);

    expect(notifCreate).toHaveBeenCalledTimes(2);
    // high-priority task → severity "red"; normal → "amber".
    const severities = notifCreate.mock.calls.map((c) => c[0].data.severity);
    expect(new Set(severities)).toEqual(new Set(["red", "amber"]));
    expect(result.dispatched).toBe(2);
  });

  it("short-circuits when no reminders are due", async () => {
    const occFindMany = vi.fn().mockResolvedValue([]);
    const occUpdateMany = vi.fn();
    const notifCreate = vi.fn();
    const prisma = makePrisma({
      taskOccurrence: {
        findMany: occFindMany,
        updateMany: occUpdateMany,
      },
      notification: { create: notifCreate },
    });

    const result = await dispatchRemindersForTenant(prisma);

    expect(occUpdateMany).not.toHaveBeenCalled();
    expect(notifCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ ready: 0, dispatched: 0, raceSkipped: 0 });
  });

  it("swallows P2002 on duplicate Notification writes under concurrent dispatch", async () => {
    const ready = [
      {
        id: "occ-1",
        occurrenceAt: new Date(),
        reminderAt: new Date(),
        reminderDispatchedAt: null,
        task: { id: "t-1", title: "X", assignedTo: "u", animalId: null, campId: null, taskType: null, priority: "normal" },
      },
    ];
    const notifCreate = vi.fn().mockRejectedValue(p2002());
    const prisma = makePrisma({
      taskOccurrence: {
        findMany: vi.fn().mockResolvedValue(ready),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      notification: { create: notifCreate },
    });

    const result = await dispatchRemindersForTenant(prisma);

    expect(notifCreate).toHaveBeenCalledTimes(1);
    expect(result.dispatched).toBe(0);
    expect(result.ready).toBe(1);
  });

  it("reports raceSkipped when another worker stamped the row first", async () => {
    const ready = [
      {
        id: "occ-1",
        occurrenceAt: new Date(),
        reminderAt: new Date(),
        reminderDispatchedAt: null,
        task: { id: "t-1", title: "X", assignedTo: "u", animalId: null, campId: null, taskType: null, priority: "normal" },
      },
      {
        id: "occ-2",
        occurrenceAt: new Date(),
        reminderAt: new Date(),
        reminderDispatchedAt: null,
        task: { id: "t-2", title: "Y", assignedTo: "u", animalId: null, campId: null, taskType: null, priority: "normal" },
      },
    ];

    let findManyCall = 0;
    const occFindMany = vi.fn().mockImplementation(() => {
      findManyCall++;
      // First call: candidates. Second call (re-read): only the row WE
      // stamped — simulate that occ-2 was claimed by another worker.
      return findManyCall === 1 ? Promise.resolve(ready) : Promise.resolve([ready[0]]);
    });

    const prisma = makePrisma({
      taskOccurrence: {
        findMany: occFindMany,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), // only 1 of 2 claimed
      },
      notification: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "n", ...data })),
      },
    });

    const result = await dispatchRemindersForTenant(prisma);

    expect(result.ready).toBe(2);
    expect(result.dispatched).toBe(1);
    expect(result.raceSkipped).toBe(1);
  });
});
