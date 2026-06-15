/**
 * @vitest-environment node
 *
 * lib/server/nudges/__tests__/do-later.test.ts — "add as task" input builder.
 *
 * do-later turns a nudge's RecommendedAction into a pending Task (decision 7).
 * The builder is a pure mapper from (action, nudgeType, ctx) → CreateTaskInput;
 * the route layer feeds it to createTask via POST /api/tasks.
 */

import { describe, it, expect } from "vitest";
import { buildNudgeTaskInput } from "@/lib/server/nudges/do-later";
import type { RecommendedAction } from "@/lib/server/alerts";

const ACTOR = "farmer@trio.test";

function action(over: Partial<RecommendedAction> = {}): RecommendedAction {
  return {
    taskType: "camp_inspection",
    target: { campId: "c1" },
    prefill: { campId: "c1" },
    label: "Inspect North",
    ...over,
  };
}

describe("buildNudgeTaskInput", () => {
  it("creates a pending task tagged recurrenceSource nudge:<type>", () => {
    const input = buildNudgeTaskInput(action(), "NEEDS_INSPECTION_DUE", {
      createdBy: ACTOR,
      now: new Date("2026-06-16T08:00:00Z"),
    });
    expect(input).toMatchObject({
      status: "pending",
      taskType: "camp_inspection",
      campId: "c1",
      createdBy: ACTOR,
      assignedTo: ACTOR,
      recurrenceSource: "nudge:NEEDS_INSPECTION_DUE",
    });
    expect(input.title).toBe("Inspect North");
    expect(input.dueDate).toBe("2026-06-16");
  });

  it("maps an animal-target action to animalId", () => {
    const input = buildNudgeTaskInput(
      action({ taskType: "weighing", target: { animalId: "a-1" }, label: "Weigh COW-12" }),
      "NO_WEIGHING_90D",
      { createdBy: ACTOR, now: new Date("2026-06-16T08:00:00Z") },
    );
    expect(input.animalId).toBe("a-1");
    expect(input.campId).toBeUndefined();
    expect(input.taskType).toBe("weighing");
  });

  it("maps a camp_move action to its destination campId", () => {
    const input = buildNudgeTaskInput(
      action({ taskType: "camp_move", target: { campId: "c2" }, label: "Move mob to South" }),
      "ROTATION_MOVE_DUE",
      { createdBy: ACTOR, now: new Date("2026-06-16T08:00:00Z") },
    );
    expect(input.campId).toBe("c2");
    expect(input.taskType).toBe("camp_move");
  });
});
