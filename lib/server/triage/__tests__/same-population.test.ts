/**
 * @vitest-environment node
 *
 * THE INVARIANT — Triage items and dashboard alerts are TWO PROJECTIONS of
 * ONE detection.
 *
 * Mirrors lib/server/alerts/__tests__/compose-monotonicity.test.ts in intent:
 * compose-monotonicity locks "a partial alert pass is a prefix of the full
 * pass"; this locks "the per-REASON alert count equals the number of
 * per-ANIMAL attention items carrying that reason."
 *
 * For every reason id:
 *   alertCount(reason)  ==  |{ items : reason ∈ item.reasons }|
 *
 * It proves the two surfaces can never silently diverge — if a future change
 * makes Triage drop or double-count an animal a reason fired on, this fails.
 *
 * The invariant is asserted two ways:
 *   1. PROJECTION level — projectAttentionItems must carry every reason from
 *      the findings exactly once per (animal, reason); per-reason item count
 *      equals per-reason distinct-animal count in the findings (= the count an
 *      aggregate alert would render). Swept over the FULL reason registry.
 *   2. SHARED-DETECTOR level — for the reused detectors (poor-doer), the count
 *      the cattle ALERT renders is literally `detectPoorDoers(...).length`,
 *      and Triage consumes the SAME `detectPoorDoers(...)` ids. One call,
 *      two consumers.
 */
import { describe, it, expect } from "vitest";
import { projectAttentionItems } from "@/lib/server/triage/project";
import { REASON_IDS } from "@/lib/server/triage/reasons";
import { detectPoorDoers } from "@/lib/species/cattle/poor-doer";
import type { Finding } from "@/lib/server/triage/types";

/**
 * Build a findings population that fires EVERY reason on a distinct, known
 * number of animals so we have a ground-truth per-reason "alert count".
 */
function buildPopulation(): { findings: Finding[]; expectedCount: Record<string, number> } {
  const findings: Finding[] = [];
  const expectedCount: Record<string, number> = {};

  // Give reason i a population of (i+1) animals, each animal carrying ONLY
  // that reason — so the per-reason count is unambiguous. Then add a handful
  // of multi-reason animals to prove grouping doesn't change the per-reason
  // tally.
  REASON_IDS.forEach((reasonId, i) => {
    const n = i + 1;
    expectedCount[reasonId] = n;
    for (let k = 0; k < n; k++) {
      findings.push({
        animalId: `${reasonId}-only-${k}`,
        reasonId,
        species: reasonId === "dosing-overdue" ? "sheep" : "cattle",
      });
    }
  });

  // Multi-reason animal carrying the first two reasons → each of those two
  // reason counts must go up by exactly 1 (one distinct animal each).
  const [r0, r1] = REASON_IDS;
  findings.push({ animalId: "multi-1", reasonId: r0, species: "cattle" });
  findings.push({ animalId: "multi-1", reasonId: r1, species: "cattle" });
  expectedCount[r0] += 1;
  expectedCount[r1] += 1;

  return { findings, expectedCount };
}

describe("same-population invariant — alerts vs triage are one detection", () => {
  it("per-reason item count equals per-reason distinct-animal (alert) count, for EVERY reason", () => {
    const { findings, expectedCount } = buildPopulation();
    const items = projectAttentionItems(findings);

    for (const reasonId of REASON_IDS) {
      const itemsWithReason = items.filter((it) =>
        it.reasons.some((r) => r.id === reasonId),
      ).length;
      expect(
        itemsWithReason,
        `reason "${reasonId}": triage item count (${itemsWithReason}) != alert count (${expectedCount[reasonId]})`,
      ).toBe(expectedCount[reasonId]);
    }
  });

  it("a repeated (animal, reason) finding does NOT inflate the per-reason count", () => {
    const findings: Finding[] = [
      { animalId: "a1", reasonId: "no-camp", species: "cattle" },
      { animalId: "a1", reasonId: "no-camp", species: "cattle" }, // dupe
      { animalId: "a2", reasonId: "no-camp", species: "cattle" },
    ];
    const items = projectAttentionItems(findings);
    const count = items.filter((it) => it.reasons.some((r) => r.id === "no-camp")).length;
    expect(count).toBe(2); // distinct animals, not finding rows
  });

  it("SHARED DETECTOR: poor-doer alert count == |triage poor-doer items| (one detectPoorDoers call)", () => {
    const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
    const weighing = [
      // P1: 0.1 kg/day → poor doer
      { animalId: "P1", observedAt: day("2026-01-01"), details: JSON.stringify({ weight_kg: 400 }) },
      { animalId: "P1", observedAt: day("2026-04-11"), details: JSON.stringify({ weight_kg: 410 }) },
      // P2: 0.1 kg/day → poor doer
      { animalId: "P2", observedAt: day("2026-01-01"), details: JSON.stringify({ weight_kg: 300 }) },
      { animalId: "P2", observedAt: day("2026-04-11"), details: JSON.stringify({ weight_kg: 310 }) },
      // G1: 1.0 kg/day → fine
      { animalId: "G1", observedAt: day("2026-01-01"), details: JSON.stringify({ weight_kg: 400 }) },
      { animalId: "G1", observedAt: day("2026-04-11"), details: JSON.stringify({ weight_kg: 500 }) },
    ];

    // The detection — ONE call. The cattle ALERT renders `.length` as its count.
    const poorDoerIds = detectPoorDoers(weighing, 0.7);
    const alertCount = poorDoerIds.length;

    // Triage consumes the SAME ids as findings.
    const findings: Finding[] = poorDoerIds.map((animalId) => ({
      animalId,
      reasonId: "poor-doer",
      species: "cattle" as const,
    }));
    const items = projectAttentionItems(findings);
    const triageCount = items.filter((it) =>
      it.reasons.some((r) => r.id === "poor-doer"),
    ).length;

    expect(alertCount).toBe(2);
    expect(triageCount).toBe(alertCount);
  });
});
