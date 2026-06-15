/**
 * @vitest-environment node
 *
 * lib/server/nudges/__tests__/narrate.test.ts — deterministic "why now" prose.
 *
 * Decision 9 — the offline narrator for a nudge. Built on the shared narration
 * primitives (lib/server/narration/templated-fallback.ts). PURE + TOTAL: same
 * item → same string. An online Einstein one-liner is OPTIONAL at the call site
 * and falls back to this. Targets/labels are engine-derived, never the LLM.
 */

import { describe, it, expect } from "vitest";
import { narrateNudge } from "@/lib/server/nudges/narrate";
import type { DoNextItem } from "@/lib/server/nudges/feed";

function item(over: Partial<DoNextItem> = {}): DoNextItem {
  return {
    id: "n1",
    type: "NO_WEIGHING_90D",
    severity: "amber",
    message: "COW-12 not weighed in 95 days",
    href: "/trio/admin/animals",
    action: { taskType: "weighing", target: { animalId: "a-1" }, prefill: {}, label: "Weigh COW-12" },
    dueDate: null,
    createdAt: "2026-06-16T08:00:00.000Z",
    ...over,
  };
}

describe("narrateNudge", () => {
  it("leads with urgency by severity and includes the alert message", () => {
    const red = narrateNudge(item({ severity: "red", message: "Camp North overdue to move" }));
    expect(red.startsWith("Do now")).toBe(true);
    expect(red).toContain("Camp North overdue to move");

    const amber = narrateNudge(item({ severity: "amber" }));
    expect(amber.startsWith("Do soon")).toBe(true);
  });

  it("names the recommended next step from the action label", () => {
    const prose = narrateNudge(item({ action: { taskType: "weighing", target: {}, prefill: {}, label: "Weigh COW-12" } }));
    expect(prose).toContain("Weigh COW-12");
  });

  it("mentions the deadline when the nudge carries a due-date", () => {
    const prose = narrateNudge(
      item({ severity: "red", message: "IT3 deadline approaching", dueDate: "2027-02-28", action: { taskType: "it3", target: {}, prefill: { taxYear: 2027 }, label: "Prepare IT3 for 2027" } }),
    );
    expect(prose).toContain("2027-02-28");
  });

  it("is deterministic — same item yields the same prose", () => {
    expect(narrateNudge(item())).toBe(narrateNudge(item()));
  });
});
