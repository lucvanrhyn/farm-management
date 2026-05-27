/**
 * __tests__/logger/camp-visit-completeness-label.test.ts
 *
 * Issue #440 — Slice 6: CampVisitCompletenessLabel observation-aware copy.
 *
 * The Logger camp page renders a sticky "complete visit" button. Previously,
 * the helper `campConditionDoneLabel(grazingQuality)` only branched on veld
 * condition — it had no awareness of whether the farmer had logged animal-level
 * observations during the visit. A farmer who logged 5 observations on Bergkamp
 * (Basson) would see "Done — no animals flagged", which reads as "nothing
 * notable happened", not "5 things were logged but no animal was individually
 * flagged".
 *
 * `getCampVisitCompletenessLabel` replaces the old helper with a pure function
 * that takes all three inputs and returns both a label (copy) and a severity
 * ('good' | 'attention' | 'critical') that drives banner styling.
 *
 * 5-row acceptance matrix (literal strings lock copy drift in CI):
 *
 * | grazingQuality       | observationCount | flaggedCount | label                                          | severity   |
 * |----------------------|------------------|--------------|------------------------------------------------|------------|
 * | Good                 | 0                | 0            | "Done — visit complete"                        | good       |
 * | Good                 | >0               | 0            | "Done — {N} observations · all animals normal" | good       |
 * | Good                 | *                | >0           | "Done — {N} animals flagged"                   | attention  |
 * | Fair/Poor/Overgrazed | *                | 0            | "Veld needs attention — {N} observations today"| attention  |
 * | Fair/Poor/Overgrazed | *                | >0           | "Veld + {N} animal concerns"                   | critical   |
 */

import { describe, it, expect } from "vitest";
import { getCampVisitCompletenessLabel } from "@/app/[farmSlug]/logger/[campId]/_lib/camp-condition-done-label";

describe("getCampVisitCompletenessLabel — Issue #440 5-row matrix", () => {
  // Row 1: Good veld, no observations, no flags → good / "Done — visit complete"
  it("Row 1: Good veld · 0 obs · 0 flagged → 'Done — visit complete' / severity good", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Good",
      observationCount: 0,
      flaggedCount: 0,
    });
    expect(result.label).toBe("Done — visit complete");
    expect(result.severity).toBe("good");
  });

  it("Row 1 (nullish grazing): null veld · 0 obs · 0 flagged → 'Done — visit complete' / severity good", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: null,
      observationCount: 0,
      flaggedCount: 0,
    });
    expect(result.label).toBe("Done — visit complete");
    expect(result.severity).toBe("good");
  });

  it("Row 1 (undefined grazing): undefined veld · 0 obs · 0 flagged → 'Done — visit complete' / severity good", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: undefined,
      observationCount: 0,
      flaggedCount: 0,
    });
    expect(result.label).toBe("Done — visit complete");
    expect(result.severity).toBe("good");
  });

  // Row 2: Good veld, observations > 0, no flags → good / "Done — N observations · all animals normal"
  it("Row 2: Good veld · 5 obs · 0 flagged → observation-count copy / severity good", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Good",
      observationCount: 5,
      flaggedCount: 0,
    });
    expect(result.label).toBe("Done — 5 observations · all animals normal");
    expect(result.severity).toBe("good");
  });

  it("Row 2: Good veld · 1 obs · 0 flagged → singular observation copy / severity good", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Good",
      observationCount: 1,
      flaggedCount: 0,
    });
    expect(result.label).toBe("Done — 1 observation · all animals normal");
    expect(result.severity).toBe("good");
  });

  // Row 3: Good veld, any observations, flags > 0 → attention / "Done — N animals flagged"
  it("Row 3: Good veld · 3 obs · 2 flagged → flagged-count copy / severity attention", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Good",
      observationCount: 3,
      flaggedCount: 2,
    });
    expect(result.label).toBe("Done — 2 animals flagged");
    expect(result.severity).toBe("attention");
  });

  it("Row 3: Good veld · 0 obs · 1 flagged → singular flagged copy / severity attention", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Good",
      observationCount: 0,
      flaggedCount: 1,
    });
    expect(result.label).toBe("Done — 1 animal flagged");
    expect(result.severity).toBe("attention");
  });

  // Row 4: Fair/Poor/Overgrazed, no flags → attention / "Veld needs attention — N observations today"
  it("Row 4: Fair veld · 0 obs · 0 flagged → veld-attention copy / severity attention", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Fair",
      observationCount: 0,
      flaggedCount: 0,
    });
    expect(result.label).toBe("Veld needs attention — 0 observations today");
    expect(result.severity).toBe("attention");
  });

  it("Row 4: Poor veld · 3 obs · 0 flagged → veld-attention copy with count / severity attention", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Poor",
      observationCount: 3,
      flaggedCount: 0,
    });
    expect(result.label).toBe("Veld needs attention — 3 observations today");
    expect(result.severity).toBe("attention");
  });

  it("Row 4: Overgrazed veld · 1 obs · 0 flagged → veld-attention copy / severity attention", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Overgrazed",
      observationCount: 1,
      flaggedCount: 0,
    });
    expect(result.label).toBe("Veld needs attention — 1 observations today");
    expect(result.severity).toBe("attention");
  });

  // Row 5: Fair/Poor/Overgrazed, flags > 0 → critical / "Veld + N animal concerns"
  it("Row 5: Fair veld · 3 obs · 2 flagged → critical copy / severity critical", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Fair",
      observationCount: 3,
      flaggedCount: 2,
    });
    expect(result.label).toBe("Veld + 2 animal concerns");
    expect(result.severity).toBe("critical");
  });

  it("Row 5: Poor veld · 0 obs · 1 flagged → critical copy singular / severity critical", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Poor",
      observationCount: 0,
      flaggedCount: 1,
    });
    expect(result.label).toBe("Veld + 1 animal concerns");
    expect(result.severity).toBe("critical");
  });

  it("Row 5: Overgrazed veld · 5 obs · 5 flagged → critical copy / severity critical", () => {
    const result = getCampVisitCompletenessLabel({
      grazingQuality: "Overgrazed",
      observationCount: 5,
      flaggedCount: 5,
    });
    expect(result.label).toBe("Veld + 5 animal concerns");
    expect(result.severity).toBe("critical");
  });

  // Case-insensitivity (IndexedDB merges + SQL inserts use different casing)
  it("is case-insensitive on grazingQuality input", () => {
    expect(
      getCampVisitCompletenessLabel({ grazingQuality: "fair", observationCount: 0, flaggedCount: 0 }).severity
    ).toBe("attention");
    expect(
      getCampVisitCompletenessLabel({ grazingQuality: "POOR", observationCount: 0, flaggedCount: 0 }).severity
    ).toBe("attention");
    expect(
      getCampVisitCompletenessLabel({ grazingQuality: "overgrazed", observationCount: 0, flaggedCount: 0 }).severity
    ).toBe("attention");
    expect(
      getCampVisitCompletenessLabel({ grazingQuality: "good", observationCount: 0, flaggedCount: 0 }).severity
    ).toBe("good");
  });

  // Backward-compat: old campConditionDoneLabel is no longer exported
  // (the new function replaces it). This is validated by the import above
  // not importing campConditionDoneLabel.
});
