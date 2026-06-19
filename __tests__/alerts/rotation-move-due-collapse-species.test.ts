/**
 * @vitest-environment node
 *
 * ROTATION_MOVE_DUE — two emergent-issue fixes (stress-test wave 2026-06-19):
 *
 *  1. COLLAPSE REGRESSION: #572 made each overdue mob get a DISTINCT destination.
 *     The collapse step (dedup.ts, collapseKey:"tenant", threshold 3) folded ≥3
 *     rotation moves into ONE notification keeping only the first mob's action,
 *     silently discarding the other distinct moves — undoing #572 at exactly the
 *     multi-mob case it targeted. Each move is a distinct physical action, so the
 *     generator must emit a PER-SOURCE-CAMP collapseKey → collapseCandidates
 *     never folds distinct moves.
 *
 *  2. SPECIES PARTITION: a rotation destination must match the mob's species
 *     (Camp/(species,campId) is a hard partition). The generator must never route
 *     a cattle mob into a sheep camp.
 */
import { describe, it, expect, vi } from "vitest";
import { makePrisma, makeSettings } from "./fixtures";

const getRotationStatusByCamp = vi.fn();
vi.mock("@/lib/server/rotation-engine", () => ({
  getRotationStatusByCamp: (...args: unknown[]) => getRotationStatusByCamp(...args),
}));

import { evaluate } from "@/lib/server/alerts/rotation-move-due";
import { collapseCandidates } from "@/lib/server/alerts";

function payload(over: Partial<Record<string, unknown>> = {}) {
  return { now: new Date().toISOString(), camps: [], nextToGraze: [], counts: {}, ...over };
}

const overstay = (campId: string, mobId: string, daysGrazed: number, species = "cattle") => ({
  campId,
  campName: campId.toUpperCase(),
  status: "overstayed",
  daysGrazed,
  currentMobs: [{ mobId, mobName: `Mob ${mobId}`, animalCount: 20, species }],
});
const restCamp = (campId: string) => ({ campId, campName: campId.toUpperCase(), status: "resting_ready", currentMobs: [] });

describe("rotation-move-due — collapse regression (#572) at ≥3 overdue mobs", () => {
  it("emits a DISTINCT collapseKey per move so 3 moves do NOT collapse into one", async () => {
    getRotationStatusByCamp.mockResolvedValue(
      payload({
        camps: [
          overstay("c1", "m1", 20),
          overstay("c2", "m2", 18),
          overstay("c3", "m3", 16),
          restCamp("r1"),
          restCamp("r2"),
          restCamp("r3"),
        ],
        nextToGraze: [
          { campId: "r1", daysRested: 70 },
          { campId: "r2", daysRested: 65 },
          { campId: "r3", daysRested: 60 },
        ],
      }),
    );
    const prisma = makePrisma({
      camp: {
        findMany: vi.fn().mockResolvedValue([
          { campId: "c1", species: "cattle" }, { campId: "c2", species: "cattle" }, { campId: "c3", species: "cattle" },
          { campId: "r1", species: "cattle" }, { campId: "r2", species: "cattle" }, { campId: "r3", species: "cattle" },
        ]),
      },
    });
    const out = await evaluate(prisma, makeSettings({}), "trio");

    expect(out).toHaveLength(3);
    // distinct destinations (the #572 guarantee at evaluate level)
    expect(new Set(out.map((c) => c.payload.targetCampId)).size).toBe(3);
    // THE FIX: distinct collapseKeys → collapse is a no-op → all 3 actions survive
    expect(new Set(out.map((c) => c.collapseKey)).size).toBe(3);
    const collapsed = collapseCandidates(out);
    expect(collapsed).toHaveLength(3);
    expect(collapsed.every((c) => c.payload.collapsed !== true)).toBe(true);
  });
});

describe("rotation-move-due — species is a hard partition", () => {
  it("does NOT route a cattle mob into a sheep camp", async () => {
    getRotationStatusByCamp.mockResolvedValue(
      payload({
        camps: [overstay("c1", "m1", 20, "cattle"), restCamp("r-sheep")],
        nextToGraze: [{ campId: "r-sheep", daysRested: 80 }],
      }),
    );
    const prisma = makePrisma({
      camp: {
        findMany: vi.fn().mockResolvedValue([
          { campId: "c1", species: "cattle" },
          { campId: "r-sheep", species: "sheep" },
        ]),
      },
    });
    const out = await evaluate(prisma, makeSettings({}), "trio");
    expect(out).toEqual([]); // no same-species destination → no move
  });

  it("still routes a cattle mob into a cattle camp (species match passes)", async () => {
    getRotationStatusByCamp.mockResolvedValue(
      payload({
        camps: [overstay("c1", "m1", 20, "cattle"), restCamp("r-cattle"), restCamp("r-sheep")],
        nextToGraze: [
          { campId: "r-sheep", daysRested: 90 }, // best-rested but wrong species → skipped
          { campId: "r-cattle", daysRested: 70 },
        ],
      }),
    );
    const prisma = makePrisma({
      camp: {
        findMany: vi.fn().mockResolvedValue([
          { campId: "c1", species: "cattle" },
          { campId: "r-cattle", species: "cattle" },
          { campId: "r-sheep", species: "sheep" },
        ]),
      },
    });
    const out = await evaluate(prisma, makeSettings({}), "trio");
    expect(out).toHaveLength(1);
    expect(out[0].payload.targetCampId).toBe("r-cattle");
  });
});
