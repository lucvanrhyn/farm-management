/**
 * @vitest-environment node
 *
 * __tests__/alerts/needs-inspection.test.ts — NEEDS_INSPECTION_DUE generator.
 *
 * Emits one candidate per camp that is stale per the SHARED
 * stale-inspection rule (same threshold as the dashboard "stale-inspections"
 * alert). Each candidate carries the campId so attachActions can map it to a
 * camp_inspection action.
 */

import { describe, it, expect, vi } from "vitest";
import { evaluate } from "@/lib/server/alerts/needs-inspection";
import { makePrisma, makeSettings } from "./fixtures";

function campRow(campId: string, campName: string) {
  return { campId, campName };
}

function inspectionObs(campId: string, hoursAgo: number) {
  return {
    campId,
    type: "camp_condition",
    observedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    details: JSON.stringify({ grazing: "Good" }),
  };
}

describe("needs-inspection generator", () => {
  it("emits NEEDS_INSPECTION_DUE for an uninspected camp and an aged camp", async () => {
    const prisma = makePrisma({
      camp: {
        findMany: vi
          .fn()
          .mockResolvedValue([campRow("c1", "North"), campRow("c2", "South"), campRow("c3", "East")]),
      },
      observation: {
        // c1 inspected 72h ago (aged), c2 inspected 1h ago (fresh), c3 never.
        findMany: vi
          .fn()
          .mockResolvedValue([inspectionObs("c1", 72), inspectionObs("c2", 1)]),
      },
    });

    const out = await evaluate(prisma, makeSettings({ alertThresholdHours: 48 }), "trio");

    const types = new Set(out.map((c) => c.type));
    expect(types).toEqual(new Set(["NEEDS_INSPECTION_DUE"]));
    const campIds = out.map((c) => (c.payload as { campId: string }).campId).sort();
    expect(campIds).toEqual(["c1", "c3"]); // aged + uninspected, NOT the fresh c2
  });

  it("carries campId + campName in payload and a farm-scoped href", async () => {
    const prisma = makePrisma({
      camp: { findMany: vi.fn().mockResolvedValue([campRow("c1", "North")]) },
      observation: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const out = await evaluate(prisma, makeSettings({ alertThresholdHours: 48 }), "trio");
    expect(out).toHaveLength(1);
    expect(out[0].payload).toMatchObject({ campId: "c1", campName: "North" });
    expect(out[0].href.startsWith("/trio/")).toBe(true);
    expect(out[0].category).toBe("performance");
    expect(out[0].collapseKey).toBe("tenant");
    expect(out[0].dedupKey.startsWith("NEEDS_INSPECTION_DUE:c1:")).toBe(true);
  });

  it("returns [] when every camp was inspected recently", async () => {
    const prisma = makePrisma({
      camp: { findMany: vi.fn().mockResolvedValue([campRow("c1", "North")]) },
      observation: { findMany: vi.fn().mockResolvedValue([inspectionObs("c1", 2)]) },
    });
    const out = await evaluate(prisma, makeSettings({ alertThresholdHours: 48 }), "trio");
    expect(out).toEqual([]);
  });
});
