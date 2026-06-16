/**
 * @vitest-environment node
 *
 * lib/server/briefing/__tests__/narrator.test.ts — Weekly Farm Briefing v1.
 *
 * narrateBriefing turns the deterministic BriefingPayload into a short prose
 * intro for the EMAIL. Contract:
 *   - MANDATORY deterministic fallback — with no ANTHROPIC_API_KEY (and any
 *     other failure path) it returns a templated string built ONLY from the
 *     payload, so a briefing ALWAYS renders.
 *   - the fallback never invents facts beyond the payload (it is a pure
 *     projection of the payload's section counts).
 *
 * The online (Anthropic) path is exercised in the budget/route layer; here we
 * lock the offline contract, which is what guarantees the email never blanks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { narrateBriefing, templatedBriefingNarration } from "../narrator";
import type { BriefingPayload } from "../payload";

function payload(over: Partial<BriefingPayload> = {}): BriefingPayload {
  return {
    farmName: "Trio-B Boerdery",
    whatChanged: [],
    whatToWatch: [],
    whatToDo: [],
    isEmpty: true,
    ...over,
  };
}

describe("templatedBriefingNarration — deterministic fallback", () => {
  it("renders an all-clear line for an empty payload", () => {
    const text = templatedBriefingNarration(payload(), "Einstein");
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toContain("trio-b");
  });

  it("summarises non-empty section counts without inventing facts", () => {
    const p = payload({
      whatChanged: ["a", "b"],
      whatToWatch: ["c"],
      whatToDo: ["d", "e", "f"],
      isEmpty: false,
    });
    const text = templatedBriefingNarration(p, "Einstein");
    // mentions the three counts (2 changed, 1 to watch, 3 to do)
    expect(text).toContain("2");
    expect(text).toContain("1");
    expect(text).toContain("3");
  });

  it("is pure — same payload yields same prose", () => {
    const p = payload({ whatChanged: ["x"], isEmpty: false });
    expect(templatedBriefingNarration(p, "Einstein")).toBe(
      templatedBriefingNarration(p, "Einstein"),
    );
  });
});

describe("narrateBriefing — falls back to template when AI is unavailable", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("returns the deterministic template (no throw) when there is no API key", async () => {
    const p = payload({ whatToWatch: ["COW-12 has low weight gain."], isEmpty: false });
    const text = await narrateBriefing(p, "Einstein");
    expect(text).toBe(templatedBriefingNarration(p, "Einstein"));
  });

  it("never throws even when the payload is empty", async () => {
    const text = await narrateBriefing(payload(), "Einstein");
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});
