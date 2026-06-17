/**
 * @vitest-environment node
 *
 * __tests__/alerts/rotation-move-due.test.ts — ROTATION_MOVE_DUE generator.
 *
 * Fires when a mob is overdue to move (its camp is `overstayed`) AND a ready
 * destination camp exists (rotation `nextToGraze[0]`). The candidate's target
 * camp = that destination, so attachActions can hang a one-tap camp_move action.
 *
 * We mock getRotationStatusByCamp (the rotation read model) so the generator's
 * own logic — "overstayed source + ready dest → candidate" — is what's tested.
 */

import { describe, it, expect, vi } from "vitest";
import { makePrisma, makeSettings } from "./fixtures";

const getRotationStatusByCamp = vi.fn();
vi.mock("@/lib/server/rotation-engine", () => ({
  getRotationStatusByCamp: (...args: unknown[]) => getRotationStatusByCamp(...args),
}));

import { evaluate } from "@/lib/server/alerts/rotation-move-due";

function payload(over: Partial<Record<string, unknown>> = {}) {
  return {
    now: new Date().toISOString(),
    camps: [],
    nextToGraze: [],
    counts: {},
    ...over,
  };
}

describe("rotation-move-due generator", () => {
  it("emits ROTATION_MOVE_DUE for an overstayed camp, targeting nextToGraze[0]", async () => {
    getRotationStatusByCamp.mockResolvedValue(
      payload({
        camps: [
          {
            campId: "c1",
            campName: "North",
            status: "overstayed",
            daysGrazed: 12,
            currentMobs: [{ mobId: "mob-1", mobName: "Steers", animalCount: 40 }],
          },
          { campId: "c2", campName: "South", status: "resting_ready", currentMobs: [] },
        ],
        nextToGraze: [
          { campId: "c2", daysRested: 65 },
          { campId: "c3", daysRested: 40 },
        ],
      }),
    );

    const out = await evaluate(makePrisma({}), makeSettings({}), "trio");

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("ROTATION_MOVE_DUE");
    expect(out[0].payload).toMatchObject({
      sourceCampId: "c1",
      targetCampId: "c2",
      mobId: "mob-1",
    });
    expect(out[0].href.startsWith("/trio/")).toBe(true);
    expect(out[0].category).toBe("veld");
    expect(out[0].dedupKey.startsWith("ROTATION_MOVE_DUE:c1:")).toBe(true);
  });

  it("also fires for an overdue_rest camp that still has a mob (overstaying)", async () => {
    getRotationStatusByCamp.mockResolvedValue(
      payload({
        camps: [
          {
            campId: "c1",
            campName: "North",
            status: "overdue_rest",
            currentMobs: [{ mobId: "mob-9", mobName: "Cows", animalCount: 30 }],
          },
        ],
        nextToGraze: [{ campId: "c2", daysRested: 70 }],
      }),
    );
    const out = await evaluate(makePrisma({}), makeSettings({}), "trio");
    expect(out).toHaveLength(1);
    expect(out[0].payload).toMatchObject({ sourceCampId: "c1", targetCampId: "c2" });
  });

  it("emits nothing when no ready destination camp exists", async () => {
    getRotationStatusByCamp.mockResolvedValue(
      payload({
        camps: [
          {
            campId: "c1",
            campName: "North",
            status: "overstayed",
            currentMobs: [{ mobId: "mob-1", mobName: "Steers", animalCount: 40 }],
          },
        ],
        nextToGraze: [], // no ready camp
      }),
    );
    const out = await evaluate(makePrisma({}), makeSettings({}), "trio");
    expect(out).toEqual([]);
  });

  it("emits nothing when no camp is overstayed/overdue", async () => {
    getRotationStatusByCamp.mockResolvedValue(
      payload({
        camps: [{ campId: "c1", campName: "North", status: "grazing", currentMobs: [{ mobId: "m" }] }],
        nextToGraze: [{ campId: "c2", daysRested: 70 }],
      }),
    );
    const out = await evaluate(makePrisma({}), makeSettings({}), "trio");
    expect(out).toEqual([]);
  });

  // ── Distinct destination per overdue mob (no double-booking) ────────────────
  it("routes two overstayed mobs to two DIFFERENT rested camps", async () => {
    getRotationStatusByCamp.mockResolvedValue(
      payload({
        camps: [
          { campId: "c1", campName: "North", status: "overstayed", daysGrazed: 15, currentMobs: [{ mobId: "m1", mobName: "Steers", animalCount: 40 }] },
          { campId: "c2", campName: "East", status: "overstayed", daysGrazed: 12, currentMobs: [{ mobId: "m2", mobName: "Cows", animalCount: 30 }] },
          { campId: "r1", campName: "South", status: "resting_ready", currentMobs: [] },
          { campId: "r2", campName: "West", status: "resting_ready", currentMobs: [] },
        ],
        nextToGraze: [
          { campId: "r1", daysRested: 65 },
          { campId: "r2", daysRested: 50 },
        ],
      }),
    );
    const out = await evaluate(makePrisma({}), makeSettings({}), "trio");
    const targets = out.map((c) => c.payload.targetCampId);
    expect(out).toHaveLength(2);
    expect(new Set(targets).size).toBe(2); // distinct — a rested camp takes one mob
    expect([...targets].sort()).toEqual(["r1", "r2"]);
  });

  it("gives the most-overdue mob (highest daysGrazed) the only ready camp when destinations are scarce", async () => {
    getRotationStatusByCamp.mockResolvedValue(
      payload({
        camps: [
          { campId: "c1", campName: "North", status: "overstayed", daysGrazed: 10, currentMobs: [{ mobId: "m1", mobName: "Steers", animalCount: 40 }] },
          { campId: "c2", campName: "East", status: "overstayed", daysGrazed: 25, currentMobs: [{ mobId: "m2", mobName: "Cows", animalCount: 30 }] },
          { campId: "r1", campName: "South", status: "resting_ready", currentMobs: [] },
        ],
        nextToGraze: [{ campId: "r1", daysRested: 65 }],
      }),
    );
    const out = await evaluate(makePrisma({}), makeSettings({}), "trio");
    expect(out).toHaveLength(1);
    expect(out[0].payload.sourceCampId).toBe("c2"); // daysGrazed 25 > 10 → most overdue wins the scarce camp
    expect(out[0].payload.targetCampId).toBe("r1");
  });
});
