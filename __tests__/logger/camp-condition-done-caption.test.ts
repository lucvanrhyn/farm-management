/**
 * __tests__/logger/camp-condition-done-caption.test.ts
 *
 * Issue #406 — TB1: explain why the Logger done-button label varies in
 * place. The branched label itself (`campConditionDoneLabel`) stays — it
 * exists by design (Wave C / U1) to stop "All Normal — Camp Good" from
 * lying on Fair / Poor / Overgrazed veld. This caption module ties the
 * button wording to the grazing quality the farmer just recorded on the
 * same form, so the divergence stops feeling like an app inconsistency.
 *
 * Contract pinned here (mirrors `campConditionDoneLabel`'s normalisation):
 *   - null / undefined / unrecognised → null (caption hides entirely)
 *   - good (case-insensitive)         → veld-good copy
 *   - fair (case-insensitive)         → veld-fair copy
 *   - poor (case-insensitive)         → veld-poor copy
 *   - overgrazed (case-insensitive)   → veld-overgrazed copy
 *
 * The caption is visually subordinate to the button (composed in page.tsx
 * with a muted-text class) and never looks like a tap-target. Caller is
 * responsible for skipping the element when the caption returns null.
 */

import { describe, it, expect } from "vitest";
import { campConditionDoneCaption } from "@/app/[farmSlug]/logger/[campId]/_lib/camp-condition-done-caption";

describe("campConditionDoneCaption — Issue #406", () => {
  it("returns null when grazing quality is null/undefined (caption hides)", () => {
    expect(campConditionDoneCaption(null)).toBeNull();
    expect(campConditionDoneCaption(undefined)).toBeNull();
  });

  it("returns null for unrecognised tiers (caption hides — safety default)", () => {
    expect(campConditionDoneCaption("Excellent")).toBeNull();
    expect(campConditionDoneCaption("")).toBeNull();
    expect(campConditionDoneCaption("Unknown")).toBeNull();
  });

  it("returns the veld-good caption when grazing quality is Good", () => {
    expect(campConditionDoneCaption("Good")).toBe(
      "Veld is in good shape — no flags raised on this visit.",
    );
  });

  it("returns the veld-fair caption when grazing quality is Fair", () => {
    expect(campConditionDoneCaption("Fair")).toBe(
      "Veld is fair — visit closed without animal-level concerns.",
    );
  });

  it("returns the veld-poor caption when grazing quality is Poor", () => {
    expect(campConditionDoneCaption("Poor")).toBe(
      "Veld is poor — visit closed without animal-level concerns. The veld itself still needs attention.",
    );
  });

  it("returns the veld-overgrazed caption when grazing quality is Overgrazed", () => {
    expect(campConditionDoneCaption("Overgrazed")).toBe(
      "Veld is overgrazed — visit closed without animal-level concerns. The veld itself still needs attention.",
    );
  });

  it("is case-insensitive on input (parity with campConditionDoneLabel)", () => {
    expect(campConditionDoneCaption("good")).toBe(
      "Veld is in good shape — no flags raised on this visit.",
    );
    expect(campConditionDoneCaption("FAIR")).toBe(
      "Veld is fair — visit closed without animal-level concerns.",
    );
    expect(campConditionDoneCaption("poor")).toBe(
      "Veld is poor — visit closed without animal-level concerns. The veld itself still needs attention.",
    );
    expect(campConditionDoneCaption("OVERGRAZED")).toBe(
      "Veld is overgrazed — visit closed without animal-level concerns. The veld itself still needs attention.",
    );
  });
});
