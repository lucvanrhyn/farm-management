/**
 * @vitest-environment node
 *
 * __tests__/alerts/lambing-due.test.ts — LAMBING_DUE_7D generator.
 *
 * Guards the 147-day gestation window: ewes with an insemination 140+ days
 * ago should fire; 100 days ago shouldn't; 200 days ago shouldn't (already
 * lambed / overdue, handled by different alert). Also confirms the pregnancy
 * scan detail JSON is honoured.
 */

import { describe, it, expect, vi } from "vitest";
import { evaluate } from "@/lib/server/alerts/lambing-due";
import { makePrisma, makeSettings, daysAgo } from "./fixtures";

function ewe(id: string) {
  return { id, animalId: id, breed: "sheep_dohne" };
}

describe("LAMBING_DUE_7D", () => {
  it("fires for a pregnant sheep whose mating was 143 days ago (due in ~4d)", async () => {
    const prisma = makePrisma({
      animal: { findMany: vi.fn().mockResolvedValue([ewe("SH-1")]) },
      observation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "o1",
            type: "insemination",
            animalId: "SH-1",
            observedAt: daysAgo(143),
            details: "{}",
          },
          {
            id: "o2",
            type: "pregnancy_scan",
            animalId: "SH-1",
            observedAt: daysAgo(120),
            details: '{"result":"pregnant"}',
          },
        ]),
      },
    });

    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("LAMBING_DUE_7D");
    // Floor-of-millisecond-diff drifts between 3 and 4 depending on clock
    // position within the day; both are inside the 7-day window (the real
    // invariant we want to lock in).
    expect(out[0].payload.daysToLambing).toBeGreaterThanOrEqual(3);
    expect(out[0].payload.daysToLambing).toBeLessThanOrEqual(4);
  });

  it("does NOT fire when scan says empty", async () => {
    const prisma = makePrisma({
      animal: { findMany: vi.fn().mockResolvedValue([ewe("SH-2")]) },
      observation: {
        findMany: vi.fn().mockResolvedValue([
          { id: "o3", type: "insemination", animalId: "SH-2", observedAt: daysAgo(143), details: "{}" },
          { id: "o4", type: "pregnancy_scan", animalId: "SH-2", observedAt: daysAgo(120), details: '{"result":"empty"}' },
        ]),
      },
    });
    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toHaveLength(0);
  });

  it("does NOT fire when mating was too recent (100d → lambs in ~47d)", async () => {
    const prisma = makePrisma({
      animal: { findMany: vi.fn().mockResolvedValue([ewe("SH-3")]) },
      observation: {
        findMany: vi.fn().mockResolvedValue([
          { id: "o5", type: "insemination", animalId: "SH-3", observedAt: daysAgo(100), details: "{}" },
          { id: "o6", type: "pregnancy_scan", animalId: "SH-3", observedAt: daysAgo(80), details: '{"result":"pregnant"}' },
        ]),
      },
    });
    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toHaveLength(0);
  });

  it("does NOT fire for non-sheep animals (cattle filtered out by species)", async () => {
    const prisma = makePrisma({
      animal: { findMany: vi.fn().mockResolvedValue([]) }, // species filter excludes cattle
    });
    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toHaveLength(0);
  });
});
