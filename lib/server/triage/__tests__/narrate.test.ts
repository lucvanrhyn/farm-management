/**
 * @vitest-environment node
 *
 * lib/server/triage/narrate.ts — deterministic offline prose for Triage.
 * Built on the shared narration primitives. PURE + TOTAL: never invents a
 * reason not present on the item.
 */
import { describe, it, expect } from "vitest";
import { narrateTriageItem, narrateHerdGlance } from "@/lib/server/triage/narrate";
import { projectAttentionItems } from "@/lib/server/triage/project";
import type { AttentionItem, Finding } from "@/lib/server/triage/types";

const f = (animalId: string, reasonId: string, species: "cattle" | "sheep" = "cattle"): Finding => ({
  animalId,
  reasonId,
  species,
});

function itemFor(findings: Finding[]): AttentionItem {
  const [item] = projectAttentionItems(findings);
  return item;
}

describe("narrateTriageItem", () => {
  it("names the animal and lists its reasons in plain English", () => {
    const item = itemFor([f("COW-12", "no-camp"), f("COW-12", "missing-dob")]);
    const prose = narrateTriageItem(item);
    expect(prose).toContain("COW-12");
    // both reasons mentioned, joined naturally
    expect(prose.toLowerCase()).toContain("camp");
    expect(prose.toLowerCase()).toContain("birth");
  });

  it("renders a single-reason item without a list connector", () => {
    const item = itemFor([f("A1", "in-withdrawal")]);
    const prose = narrateTriageItem(item);
    expect(prose).toContain("A1");
    expect(prose).not.toContain(" and ");
  });

  it("NEVER mentions a reason the item does not carry", () => {
    const item = itemFor([f("A1", "no-camp")]);
    const prose = narrateTriageItem(item).toLowerCase();
    // 'in-withdrawal'/'dosing' phrasing must be absent
    expect(prose).not.toContain("withdrawal");
    expect(prose).not.toContain("dosing");
  });

  it("is deterministic", () => {
    const item = itemFor([f("A1", "no-camp"), f("A1", "missing-id")]);
    expect(narrateTriageItem(item)).toBe(narrateTriageItem(item));
  });
});

describe("narrateHerdGlance", () => {
  it("empty list → an explicit all-clear line", () => {
    const prose = narrateHerdGlance([]);
    expect(prose.length).toBeGreaterThan(0);
    expect(prose.toLowerCase()).toMatch(/no animals|all|nothing|clear/);
  });

  it("summarises the count and how many are urgent (red)", () => {
    const items = projectAttentionItems([
      f("a1", "in-withdrawal"),
      f("a2", "no-camp"),
      f("a3", "missing-dob"),
    ]);
    const prose = narrateHerdGlance(items);
    expect(prose).toContain("3"); // total animals needing attention
    expect(prose).toContain("1"); // 1 urgent (red)
  });

  it("is deterministic", () => {
    const items = projectAttentionItems([f("a1", "no-camp"), f("a2", "in-withdrawal")]);
    expect(narrateHerdGlance(items)).toBe(narrateHerdGlance(items));
  });
});
