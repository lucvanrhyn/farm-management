/**
 * @vitest-environment node
 *
 * lib/server/alerts/__tests__/stale-inspection.test.ts — the shared
 * stale-camp-inspection detection extracted from compose.ts so the dashboard
 * alert and the NEEDS_INSPECTION_DUE notification use ONE threshold + one
 * counting rule (no duplicated math).
 */

import { describe, it, expect } from "vitest";
import { computeStaleCampInspectionCount } from "../stale-inspection";
import type { LiveCampStatus } from "@/lib/server/camp-status";

const NOW = new Date("2026-06-16T08:00:00.000Z");

function status(hoursAgo: number): LiveCampStatus {
  return {
    grazing_quality: "Good",
    water_status: "Full",
    fence_status: "Intact",
    last_inspected_at: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toISOString(),
    last_inspected_by: null,
  };
}

describe("computeStaleCampInspectionCount", () => {
  it("counts uninspected camps (totalCamps minus inspected) + aged camps", () => {
    // 3 total camps, 1 inspected 72h ago (stale), 2 never inspected.
    const conditions = new Map<string, LiveCampStatus>([["c1", status(72)]]);
    const count = computeStaleCampInspectionCount(conditions, 3, 48, NOW);
    expect(count).toBe(3); // 2 uninspected + 1 aged
  });

  it("does not count a camp inspected within the threshold", () => {
    const conditions = new Map<string, LiveCampStatus>([["c1", status(1)]]);
    const count = computeStaleCampInspectionCount(conditions, 1, 48, NOW);
    expect(count).toBe(0);
  });

  it("returns 0 when totalCamps is null (no source)", () => {
    const conditions = new Map<string, LiveCampStatus>([["c1", status(72)]]);
    const count = computeStaleCampInspectionCount(conditions, null, 48, NOW);
    expect(count).toBe(0);
  });
});

describe("computeStaleCampIds — which camps are stale", () => {
  it("lists uninspected + aged camp ids", async () => {
    const { computeStaleCampIds } = await import("../stale-inspection");
    const conditions = new Map<string, LiveCampStatus>([
      ["c1", status(72)], // aged
      ["c2", status(1)], // fresh
    ]);
    const allCampIds = ["c1", "c2", "c3"]; // c3 never inspected
    const stale = computeStaleCampIds(conditions, allCampIds, 48, NOW);
    expect(stale.sort()).toEqual(["c1", "c3"]);
  });
});
