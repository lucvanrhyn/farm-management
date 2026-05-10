/**
 * __tests__/logger/camp-condition-done-label.test.ts
 *
 * Wave C / U1 — Codex audit P2 polish (2026-05-10).
 *
 * The logger camp page renders a sticky "complete visit" button. When the
 * user has flagged zero animals, the button used to ALWAYS read
 * "All Normal — Camp Good", regardless of the camp's grazing condition.
 *
 * Codex audit flagged the copy as a lie on Fair / Poor / Overgrazed camps —
 * "no animals flagged" is still a legitimate outcome on a poor-condition
 * camp (the camp's veld can be bad without any sick animals), but the
 * button must not also claim "Camp Good" when the camp clearly isn't.
 *
 * Contract pinned here:
 *   - good / unknown / nullish → "All Normal — Camp Good" (unchanged)
 *   - Fair / Poor / Overgrazed (case-insensitive) → "Done — no animals flagged"
 *
 * The helper lives in a sibling `_lib/` file (underscore folder = not
 * routed by Next.js) so it can be a pure unit-tested function without
 * tripping Next 16's page export contract.
 */

import { describe, it, expect } from "vitest";
import { campConditionDoneLabel } from "@/app/[farmSlug]/logger/[campId]/_lib/camp-condition-done-label";

describe("campConditionDoneLabel — Wave C / U1", () => {
  it("returns 'All Normal — Camp Good' when grazing quality is null/undefined", () => {
    expect(campConditionDoneLabel(null)).toBe("All Normal — Camp Good");
    expect(campConditionDoneLabel(undefined)).toBe("All Normal — Camp Good");
  });

  it("returns 'All Normal — Camp Good' when grazing quality is Good", () => {
    expect(campConditionDoneLabel("Good")).toBe("All Normal — Camp Good");
  });

  it("returns 'All Normal — Camp Good' for unknown / unrecognised tiers (safety default)", () => {
    expect(campConditionDoneLabel("Excellent")).toBe("All Normal — Camp Good");
    expect(campConditionDoneLabel("")).toBe("All Normal — Camp Good");
  });

  it("returns 'Done — no animals flagged' when grazing quality is Fair", () => {
    expect(campConditionDoneLabel("Fair")).toBe("Done — no animals flagged");
  });

  it("returns 'Done — no animals flagged' when grazing quality is Poor", () => {
    expect(campConditionDoneLabel("Poor")).toBe("Done — no animals flagged");
  });

  it("returns 'Done — no animals flagged' when grazing quality is Overgrazed", () => {
    expect(campConditionDoneLabel("Overgrazed")).toBe("Done — no animals flagged");
  });

  it("is case-insensitive on input (IndexedDB merges + SQL inserts use different casing)", () => {
    expect(campConditionDoneLabel("fair")).toBe("Done — no animals flagged");
    expect(campConditionDoneLabel("POOR")).toBe("Done — no animals flagged");
    expect(campConditionDoneLabel("overgrazed")).toBe("Done — no animals flagged");
    expect(campConditionDoneLabel("good")).toBe("All Normal — Camp Good");
  });
});
