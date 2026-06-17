/**
 * @vitest-environment node
 *
 * lib/server/alerts/__tests__/rotation-move-due.test.ts — ROTATION_MOVE_DUE must
 * give each overdue mob a DISTINCT ready destination. A rested camp can only
 * receive one mob, so two mobs that are both overdue must not be told to move
 * into the same camp. The pre-fix code read `nextToGraze[0]` once before the loop
 * and stamped it onto every candidate, double-booking the single best camp.
 *
 * When ready destinations are scarcer than overdue mobs, the most urgent mob
 * (overstayed > overdue_rest) gets first pick and the remainder emit nothing
 * rather than a move-to-an-occupied-camp nudge.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FarmSettings } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  rotation: {
    camps: [] as Array<{
      campId: string;
      campName: string;
      status: string;
      currentMobs: Array<{ mobId: string | null; mobName: string | null }>;
    }>,
    nextToGraze: [] as Array<{ campId: string; daysRested: number | null }>,
  },
}));

vi.mock("@/lib/server/rotation-engine", () => ({
  getRotationStatusByCamp: vi.fn(() => Promise.resolve(mocks.rotation)),
}));

import { evaluate } from "../rotation-move-due";

const prisma = {} as unknown as PrismaClient;
const settings = {} as unknown as FarmSettings;

function camp(
  campId: string,
  status: string,
  mob?: string,
): {
  campId: string;
  campName: string;
  status: string;
  currentMobs: Array<{ mobId: string | null; mobName: string | null }>;
} {
  return {
    campId,
    campName: `Camp ${campId}`,
    status,
    currentMobs: mob ? [{ mobId: mob, mobName: `Mob ${mob}` }] : [],
  };
}

describe("ROTATION_MOVE_DUE — distinct destination per overdue mob", () => {
  beforeEach(() => {
    mocks.rotation.camps = [];
    mocks.rotation.nextToGraze = [];
  });

  it("routes two overdue mobs to two DIFFERENT rested camps", async () => {
    mocks.rotation.camps = [
      camp("A", "overstayed", "mA"),
      camp("B", "overdue_rest", "mB"),
      camp("R1", "resting"),
      camp("R2", "resting"),
    ];
    mocks.rotation.nextToGraze = [
      { campId: "R1", daysRested: 40 },
      { campId: "R2", daysRested: 30 },
    ];

    const candidates = await evaluate(prisma, settings, "farm");
    const targets = candidates.map((c) => c.payload.targetCampId);

    expect(candidates).toHaveLength(2);
    expect(new Set(targets).size).toBe(2); // distinct — no double-booking
    expect([...targets].sort()).toEqual(["R1", "R2"]);
  });

  it("gives the most urgent mob (overstayed) the only ready camp when destinations are scarce", async () => {
    mocks.rotation.camps = [
      camp("A", "overdue_rest", "mA"),
      camp("B", "overstayed", "mB"),
      camp("R1", "resting"),
    ];
    mocks.rotation.nextToGraze = [{ campId: "R1", daysRested: 40 }];

    const candidates = await evaluate(prisma, settings, "farm");

    expect(candidates).toHaveLength(1);
    expect(candidates[0].payload.sourceCampId).toBe("B"); // overstayed wins
    expect(candidates[0].payload.targetCampId).toBe("R1");
    expect(candidates[0].severity).toBe("red");
  });

  it("still emits a single nudge for a single overdue mob (regression)", async () => {
    mocks.rotation.camps = [camp("A", "overstayed", "mA"), camp("R1", "resting")];
    mocks.rotation.nextToGraze = [{ campId: "R1", daysRested: 40 }];

    const candidates = await evaluate(prisma, settings, "farm");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].payload.sourceCampId).toBe("A");
    expect(candidates[0].payload.targetCampId).toBe("R1");
  });

  it("emits nothing when no rested camp is ready (regression)", async () => {
    mocks.rotation.camps = [camp("A", "overstayed", "mA"), camp("B", "overdue_rest", "mB")];
    mocks.rotation.nextToGraze = [];

    const candidates = await evaluate(prisma, settings, "farm");
    expect(candidates).toEqual([]);
  });
});
