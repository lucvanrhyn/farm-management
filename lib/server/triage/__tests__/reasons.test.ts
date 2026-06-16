/**
 * @vitest-environment node
 *
 * lib/server/triage/reasons.ts — the Triage REASON_REGISTRY.
 *
 * Urgency weights are NET-NEW to Triage (AlertThresholds carries only
 * detection cutoffs, no weights). The registry is the single source of
 * truth for every reason's severity + weight, consumed by the projection.
 */
import { describe, it, expect } from "vitest";
import {
  REASON_REGISTRY,
  REASON_IDS,
  reasonMeta,
  type ReasonId,
} from "@/lib/server/triage/reasons";

describe("REASON_REGISTRY", () => {
  it("every reason carries a severity and a positive weight", () => {
    for (const id of REASON_IDS) {
      const meta = REASON_REGISTRY[id];
      expect(meta.severity === "red" || meta.severity === "amber").toBe(true);
      expect(typeof meta.weight).toBe("number");
      expect(meta.weight).toBeGreaterThan(0);
    }
  });

  it("red reasons outweigh amber reasons (a red always sorts ahead)", () => {
    const reds = REASON_IDS.filter((id) => REASON_REGISTRY[id].severity === "red");
    const ambers = REASON_IDS.filter((id) => REASON_REGISTRY[id].severity === "amber");
    const minRed = Math.min(...reds.map((id) => REASON_REGISTRY[id].weight));
    const maxAmber = Math.max(...ambers.map((id) => REASON_REGISTRY[id].weight));
    expect(minRed).toBeGreaterThan(maxAmber);
  });

  it("includes the v1 snapshot + history reason ids", () => {
    // Snapshot reasons
    expect(REASON_IDS).toContain("no-camp");
    expect(REASON_IDS).toContain("missing-id");
    expect(REASON_IDS).toContain("missing-dob");
    expect(REASON_IDS).toContain("age-for-category");
    expect(REASON_IDS).toContain("no-weight-on-record");
    // History reasons (reuse)
    expect(REASON_IDS).toContain("poor-doer");
    expect(REASON_IDS).toContain("dosing-overdue");
    expect(REASON_IDS).toContain("in-withdrawal");
  });

  it("in-withdrawal is red (animal must not be sold/slaughtered)", () => {
    expect(REASON_REGISTRY["in-withdrawal"].severity).toBe("red");
  });

  it("reasonMeta builds a full Reason from a registry id", () => {
    const id: ReasonId = "no-camp";
    const r = reasonMeta(id);
    expect(r).toEqual({
      id: "no-camp",
      severity: REASON_REGISTRY["no-camp"].severity,
      weight: REASON_REGISTRY["no-camp"].weight,
    });
  });

  it("REASON_IDS matches the registry keys exactly", () => {
    expect(new Set(REASON_IDS)).toEqual(new Set(Object.keys(REASON_REGISTRY)));
    expect(REASON_IDS.length).toBe(Object.keys(REASON_REGISTRY).length);
  });
});
