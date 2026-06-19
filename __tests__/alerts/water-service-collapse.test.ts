/**
 * @vitest-environment node
 *
 * WATER_SERVICE_OVERDUE_30D — collapse regression (stress-test wave 2026-06-19).
 *
 * Each overdue/broken water point is a DISTINCT physical service task with its
 * own one-tap schedule action. With collapseKey:"tenant" + threshold 3, a farm
 * with ≥3 overdue water points folded them into ONE notification keeping only
 * the first borehole's action — the other boreholes became unschedulable from
 * the Do-Next panel. The generator must emit a PER-WATER-POINT collapseKey so
 * collapseCandidates never folds distinct boreholes together.
 */
import { describe, it, expect, vi } from "vitest";
import { makePrisma, makeSettings, daysAgo } from "./fixtures";

import { evaluate } from "@/lib/server/alerts/water-service";
import { collapseCandidates } from "@/lib/server/alerts";

describe("water-service — distinct boreholes do not collapse", () => {
  it("emits a DISTINCT collapseKey per water point so 3 overdue boreholes stay individually schedulable", async () => {
    const prisma = makePrisma({
      gameWaterPoint: {
        findMany: vi.fn().mockResolvedValue([
          { id: "wp1", name: "Borehole 1", lastInspected: daysAgo(45).toISOString(), status: "operational" },
          { id: "wp2", name: "Borehole 2", lastInspected: daysAgo(60).toISOString(), status: "operational" },
          { id: "wp3", name: "Trough 3", lastInspected: daysAgo(90).toISOString(), status: "operational" },
        ]),
      },
    });
    const out = await evaluate(prisma, makeSettings({}), "trio");

    expect(out).toHaveLength(3);
    expect(new Set(out.map((c) => c.collapseKey)).size).toBe(3); // per-borehole
    const collapsed = collapseCandidates(out);
    expect(collapsed).toHaveLength(3); // THE FIX: no fold — each borehole keeps its own action
    expect(collapsed.every((c) => c.payload.collapsed !== true)).toBe(true);
  });
});
