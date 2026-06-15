/**
 * @vitest-environment node
 *
 * lib/server/nudges/__tests__/task-dedup.test.ts — "already scheduled" suppression.
 *
 * Given a RecommendedAction target, query pending Tasks by taskType + the
 * matching scope id (campId / animalId). A hit ⇒ the feed marks the nudge
 * "already scheduled" so it doesn't double-prompt the farmer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isActionAlreadyScheduled } from "@/lib/server/nudges/task-dedup";
import type { RecommendedAction } from "@/lib/server/alerts";

const { listTasksUnbounded } = vi.hoisted(() => ({ listTasksUnbounded: vi.fn() }));
vi.mock("@/lib/domain/tasks/list-tasks", () => ({
  listTasksUnbounded: (...a: unknown[]) => listTasksUnbounded(...a),
}));

beforeEach(() => {
  listTasksUnbounded.mockReset();
});

const prisma = {} as never;

function action(over: Partial<RecommendedAction> = {}): RecommendedAction {
  return {
    taskType: "weighing",
    target: { animalId: "a-1" },
    prefill: {},
    label: "Weigh",
    ...over,
  };
}

describe("isActionAlreadyScheduled", () => {
  it("returns true when a pending task matches taskType + animalId", async () => {
    listTasksUnbounded.mockResolvedValue([{ id: "t1", status: "pending", taskType: "weighing", animalId: "a-1" }]);
    const hit = await isActionAlreadyScheduled(prisma, action());
    expect(hit).toBe(true);
    // queried pending tasks scoped to taskType + animalId
    expect(listTasksUnbounded).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ status: "pending", taskType: "weighing" }),
    );
  });

  it("returns true when a pending task matches taskType + campId", async () => {
    listTasksUnbounded.mockResolvedValue([{ id: "t2", status: "pending", taskType: "camp_inspection", campId: "c1" }]);
    const hit = await isActionAlreadyScheduled(
      prisma,
      action({ taskType: "camp_inspection", target: { campId: "c1" } }),
    );
    expect(hit).toBe(true);
    expect(listTasksUnbounded).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ status: "pending", taskType: "camp_inspection", campId: "c1" }),
    );
  });

  it("returns false when no pending task matches", async () => {
    listTasksUnbounded.mockResolvedValue([]);
    const hit = await isActionAlreadyScheduled(prisma, action());
    expect(hit).toBe(false);
  });

  it("returns false for an action with no usable target id", async () => {
    const hit = await isActionAlreadyScheduled(prisma, action({ target: {} }));
    expect(hit).toBe(false);
    expect(listTasksUnbounded).not.toHaveBeenCalled();
  });

  it("is resilient — returns false if the task query throws", async () => {
    listTasksUnbounded.mockRejectedValue(new Error("db down"));
    const hit = await isActionAlreadyScheduled(prisma, action());
    expect(hit).toBe(false);
  });
});
