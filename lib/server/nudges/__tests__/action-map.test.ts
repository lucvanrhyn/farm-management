/**
 * @vitest-environment node
 *
 * lib/server/nudges/__tests__/action-map.test.ts — the deterministic
 * type → RecommendedAction table + attachActions enrichment.
 *
 * The mapping is a fixed table (NEVER the LLM): targets + prefill are pulled
 * from the alert-engine payload. Info-only signals get NO action.
 */

import { describe, it, expect } from "vitest";
import { attachActions, mapAction } from "@/lib/server/nudges/action-map";
import type { AlertCandidate } from "@/lib/server/alerts";

function mk(over: Partial<AlertCandidate>): AlertCandidate {
  return {
    type: "NO_WEIGHING_90D",
    category: "performance",
    severity: "amber",
    dedupKey: "k",
    collapseKey: null,
    payload: {},
    message: "m",
    href: "/trio/admin/animals",
    expiresAt: new Date(Date.now() + 1000),
    ...over,
  };
}

const CTX = { farmSlug: "trio", tier: "advanced" as const };

describe("mapAction — the 6-row table", () => {
  it("NO_WEIGHING_90D → weighing action targeting the animal", () => {
    const a = mapAction(
      mk({ type: "NO_WEIGHING_90D", payload: { animalId: "COW-12", animalInternalId: "a-1" } }),
      CTX,
    );
    expect(a).toMatchObject({ taskType: "weighing", target: { animalId: "a-1" } });
    expect(a!.prefill).toMatchObject({ animalId: "COW-12" });
  });

  it("SHEARING_DUE → shearing action", () => {
    const a = mapAction(mk({ type: "SHEARING_DUE", payload: { animalInternalId: "a-9", animalId: "EWE-9" } }), CTX);
    expect(a).toMatchObject({ taskType: "shearing", target: { animalId: "a-9" } });
  });

  it("CRUTCHING_DUE → shearing action", () => {
    const a = mapAction(mk({ type: "CRUTCHING_DUE", payload: { animalInternalId: "a-9", animalId: "EWE-9" } }), CTX);
    expect(a).toMatchObject({ taskType: "shearing", target: { animalId: "a-9" } });
  });

  it("WATER_SERVICE_OVERDUE_30D → water_point_service targeting the water point", () => {
    const a = mapAction(
      mk({ type: "WATER_SERVICE_OVERDUE_30D", payload: { waterPointId: "wp-3", name: "Borehole 3" } }),
      CTX,
    );
    expect(a).toMatchObject({ taskType: "water_point_service", target: { waterPointId: "wp-3" } });
  });

  it("NEEDS_INSPECTION_DUE → camp_inspection targeting the camp", () => {
    const a = mapAction(
      mk({ type: "NEEDS_INSPECTION_DUE", payload: { campId: "c1", campName: "North" } }),
      CTX,
    );
    expect(a).toMatchObject({ taskType: "camp_inspection", target: { campId: "c1" } });
  });

  it("ROTATION_MOVE_DUE → camp_move targeting the destination camp", () => {
    const a = mapAction(
      mk({
        type: "ROTATION_MOVE_DUE",
        payload: { sourceCampId: "c1", targetCampId: "c2", mobId: "mob-1" },
      }),
      CTX,
    );
    expect(a).toMatchObject({ taskType: "camp_move", target: { campId: "c2" } });
    expect(a!.prefill).toMatchObject({ sourceCampId: "c1", targetCampId: "c2", mobId: "mob-1" });
  });

  it("TAX_DEADLINE_IT3 → it3 action with taxYear prefill (advanced tier)", () => {
    const a = mapAction(
      mk({ type: "TAX_DEADLINE_IT3", payload: { deadline: "2027-02-28", type: "IT3" } }),
      CTX,
    );
    expect(a).toBeDefined();
    expect(a!.taskType).toBe("it3");
    expect(a!.upgradeGated).toBeFalsy();
    expect(typeof a!.prefill.taxYear).toBe("number");
  });

  it("TAX_DEADLINE_IT3 on a non-advanced farm → upgrade-gated action", () => {
    const a = mapAction(
      mk({ type: "TAX_DEADLINE_IT3", payload: { deadline: "2027-02-28", type: "IT3" } }),
      { farmSlug: "trio", tier: "basic" },
    );
    expect(a).toBeDefined();
    expect(a!.upgradeGated).toBe(true);
  });

  it("info-only signals carry NO action", () => {
    for (const type of [
      "LSU_OVERSTOCK",
      "PREDATOR_SPIKE",
      "SPI_DROUGHT",
      "RAINFALL_NOT_LOGGED",
      "COVER_READING_STALE_21D",
      "COG_EXCEEDS_BREAKEVEN",
      "LAMBING_DUE_7D",
      "FAWNING_DUE",
    ]) {
      expect(mapAction(mk({ type }), CTX)).toBeNull();
    }
  });
});

describe("attachActions — enrichment", () => {
  it("merges action into payload.action AND the typed field for mapped types", () => {
    const candidates = [
      mk({ type: "NO_WEIGHING_90D", payload: { animalId: "COW-12", animalInternalId: "a-1" } }),
      mk({ type: "LSU_OVERSTOCK", payload: {} }),
    ];
    const out = attachActions(candidates, CTX);
    expect(out[0].action).toMatchObject({ taskType: "weighing" });
    expect((out[0].payload as { action?: unknown }).action).toMatchObject({ taskType: "weighing" });
    // info-only candidate untouched
    expect(out[1].action).toBeUndefined();
    expect((out[1].payload as { action?: unknown }).action).toBeUndefined();
  });

  it("does not mutate the input candidates (immutability)", () => {
    const input = mk({ type: "NO_WEIGHING_90D", payload: { animalInternalId: "a-1", animalId: "COW-12" } });
    const out = attachActions([input], CTX);
    expect(input.action).toBeUndefined();
    expect(out[0]).not.toBe(input);
  });

  it("an unmapped type passes through with no action", () => {
    const out = attachActions([mk({ type: "SOMETHING_NEW", payload: {} })], CTX);
    expect(out[0].action).toBeUndefined();
  });

  it("stamps the candidate category into payload so the feed can rank it", () => {
    const out = attachActions(
      [mk({ type: "NEEDS_INSPECTION_DUE", category: "performance", payload: { campId: "c1" } })],
      CTX,
    );
    expect((out[0].payload as { category?: string }).category).toBe("performance");
  });

  it("stamps a dueDate into payload from a tax deadline so proximity-ranking works", () => {
    const out = attachActions(
      [mk({ type: "TAX_DEADLINE_IT3", category: "compliance", payload: { deadline: "2027-02-28", type: "IT3" } })],
      CTX,
    );
    expect((out[0].payload as { dueDate?: string }).dueDate).toBe("2027-02-28");
  });
});
