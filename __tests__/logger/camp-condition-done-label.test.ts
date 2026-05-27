/**
 * __tests__/logger/camp-condition-done-label.test.ts
 *
 * Wave C / U1 — Codex audit P2 polish (2026-05-10).
 * Issue #440 — Updated: tests migrated from `campConditionDoneLabel` (removed)
 * to `getCampVisitCompletenessLabel` which supersedes it.
 *
 * The logger camp page renders a sticky "complete visit" button. The helper
 * now accepts `{ grazingQuality, observationCount, flaggedCount }` and returns
 * `{ label, severity }` — observation-aware copy that reflects veld condition
 * AND any observations or flags logged during the visit.
 *
 * This file preserves the Wave C / U1 contract as a subset:
 *  - Good/null/undefined + 0 obs + 0 flagged → "Done — visit complete" / good
 *  - Fair/Poor/Overgrazed + 0 obs + 0 flagged → "Veld needs attention — 0 observations today" / attention
 *
 * Full 5-row matrix is in camp-visit-completeness-label.test.ts (Issue #440).
 *
 * The helper lives in a sibling `_lib/` file (underscore folder = not
 * routed by Next.js) so it can be a pure unit-tested function without
 * tripping Next 16's page export contract.
 */

import { describe, it, expect } from "vitest";
import { getCampVisitCompletenessLabel } from "@/app/[farmSlug]/logger/[campId]/_lib/camp-condition-done-label";

describe("getCampVisitCompletenessLabel — Wave C / U1 baseline contract", () => {
  it("returns severity 'good' when grazing quality is null/undefined and no activity", () => {
    expect(getCampVisitCompletenessLabel({ grazingQuality: null, observationCount: 0, flaggedCount: 0 }).severity).toBe("good");
    expect(getCampVisitCompletenessLabel({ grazingQuality: undefined, observationCount: 0, flaggedCount: 0 }).severity).toBe("good");
  });

  it("returns 'Done — visit complete' when grazing quality is Good and no activity", () => {
    expect(getCampVisitCompletenessLabel({ grazingQuality: "Good", observationCount: 0, flaggedCount: 0 }).label).toBe("Done — visit complete");
  });

  it("returns severity 'good' for unknown / unrecognised tiers (safety default)", () => {
    expect(getCampVisitCompletenessLabel({ grazingQuality: "Excellent", observationCount: 0, flaggedCount: 0 }).severity).toBe("good");
    expect(getCampVisitCompletenessLabel({ grazingQuality: "", observationCount: 0, flaggedCount: 0 }).severity).toBe("good");
  });

  it("returns severity 'attention' when grazing quality is Fair and no flags", () => {
    expect(getCampVisitCompletenessLabel({ grazingQuality: "Fair", observationCount: 0, flaggedCount: 0 }).severity).toBe("attention");
  });

  it("returns severity 'attention' when grazing quality is Poor and no flags", () => {
    expect(getCampVisitCompletenessLabel({ grazingQuality: "Poor", observationCount: 0, flaggedCount: 0 }).severity).toBe("attention");
  });

  it("returns severity 'attention' when grazing quality is Overgrazed and no flags", () => {
    expect(getCampVisitCompletenessLabel({ grazingQuality: "Overgrazed", observationCount: 0, flaggedCount: 0 }).severity).toBe("attention");
  });

  it("is case-insensitive on input (IndexedDB merges + SQL inserts use different casing)", () => {
    expect(getCampVisitCompletenessLabel({ grazingQuality: "fair", observationCount: 0, flaggedCount: 0 }).severity).toBe("attention");
    expect(getCampVisitCompletenessLabel({ grazingQuality: "POOR", observationCount: 0, flaggedCount: 0 }).severity).toBe("attention");
    expect(getCampVisitCompletenessLabel({ grazingQuality: "overgrazed", observationCount: 0, flaggedCount: 0 }).severity).toBe("attention");
    expect(getCampVisitCompletenessLabel({ grazingQuality: "good", observationCount: 0, flaggedCount: 0 }).severity).toBe("good");
  });
});
