/**
 * @vitest-environment node
 *
 * lib/server/briefing/__tests__/payload.test.ts — Weekly Farm Briefing v1.
 *
 * buildBriefingPayload is the deterministic SOURCE OF TRUTH for the briefing.
 * It maps each already-fetched source to one of three sections
 * (whatChanged / whatToWatch / whatToDo) and OMITS a source when it is
 * empty/absent (graceful degradation is load-bearing — the LLM never invents
 * facts, so the in-app card and the email both render whatever the payload
 * carries and nothing more).
 *
 * PURE + TOTAL: same inputs → same output, no I/O, no clock read beyond the
 * caller-supplied `now`. That is what lets every source→section mapping be
 * unit-tested for an exact value.
 */

import { describe, it, expect } from "vitest";
import { buildBriefingPayload, type BriefingSources } from "../payload";
import type { AttentionItem } from "@/lib/server/triage/types";
import type { DoNextItem } from "@/lib/server/nudges/feed";

const NOW = new Date("2026-06-15T05:00:00.000Z");

function emptySources(): BriefingSources {
  return {
    farmName: "Trio-B Boerdery",
    notifications: [],
    attentionItems: [],
    doNext: [],
    keyChanges: {
      weightsLogged: 0,
      reproEvents: 0,
      deaths: 0,
      sales: 0,
      veld: null,
      drought: null,
    },
    now: NOW,
  };
}

describe("buildBriefingPayload — empty → all sections empty (graceful degradation)", () => {
  it("returns empty sections when every source is absent", () => {
    const p = buildBriefingPayload(emptySources());
    expect(p.whatChanged).toEqual([]);
    expect(p.whatToWatch).toEqual([]);
    expect(p.whatToDo).toEqual([]);
    expect(p.farmName).toBe("Trio-B Boerdery");
    expect(p.isEmpty).toBe(true);
  });
});

describe("buildBriefingPayload — recent notifications → what changed", () => {
  it("summarises 7-day notifications into a 'what changed' line, newest first", () => {
    const sources = emptySources();
    sources.notifications = [
      { id: "n1", type: "COVER_READING_LOW", severity: "amber", message: "Camp 7 low cover", href: "/x", createdAt: "2026-06-12T00:00:00Z" },
      { id: "n2", type: "PREDATOR_SPIKE", severity: "red", message: "Predator spike at boundary", href: "/y", createdAt: "2026-06-14T00:00:00Z" },
    ];
    const p = buildBriefingPayload(sources);
    expect(p.whatChanged.length).toBeGreaterThan(0);
    // The most recent (n2 red) leads.
    expect(p.whatChanged[0]).toContain("Predator spike at boundary");
    expect(p.isEmpty).toBe(false);
  });

  it("omits the notifications line entirely when there are none", () => {
    const p = buildBriefingPayload(emptySources());
    expect(p.whatChanged).toEqual([]);
  });
});

describe("buildBriefingPayload — top attention items → what to watch", () => {
  it("renders the top attention items as 'what to watch' lines", () => {
    const items: AttentionItem[] = [
      { animalId: "COW-12", reasons: [{ id: "poor-doer", severity: "amber", weight: 3 }], urgency: 3, severity: "amber", species: "cattle" },
      { animalId: "COW-99", reasons: [{ id: "in-withdrawal", severity: "red", weight: 5 }], urgency: 5, severity: "red", species: "cattle" },
    ];
    const sources = emptySources();
    sources.attentionItems = items;
    const p = buildBriefingPayload(sources);
    expect(p.whatToWatch.length).toBeGreaterThan(0);
    expect(p.whatToWatch.join(" ")).toContain("COW-12");
  });

  it("caps the watch list at the configured TOP_N", () => {
    const items: AttentionItem[] = Array.from({ length: 20 }, (_, i) => ({
      animalId: `A-${i}`,
      reasons: [{ id: "poor-doer", severity: "amber" as const, weight: 1 }],
      urgency: 1,
      severity: "amber" as const,
      species: "cattle" as const,
    }));
    const sources = emptySources();
    sources.attentionItems = items;
    const p = buildBriefingPayload(sources);
    // animal lines + a herd-glance summary line, but never all 20 animals.
    expect(p.whatToWatch.length).toBeLessThanOrEqual(6);
  });
});

describe("buildBriefingPayload — nudges feed → what to do", () => {
  it("renders the top recommended actions as 'what to do' lines", () => {
    const doNext: DoNextItem[] = [
      {
        id: "d1",
        type: "TAX_DEADLINE",
        severity: "red",
        message: "Provisional tax due",
        href: "/tax",
        action: { taskType: "tax_filing", label: "File provisional tax" } as DoNextItem["action"],
        dueDate: "2026-06-30",
        createdAt: "2026-06-14T00:00:00Z",
      },
    ];
    const sources = emptySources();
    sources.doNext = doNext;
    const p = buildBriefingPayload(sources);
    expect(p.whatToDo.length).toBeGreaterThan(0);
    expect(p.whatToDo.join(" ")).toContain("File provisional tax");
  });

  it("omits the do list when there are no action-carrying nudges", () => {
    const p = buildBriefingPayload(emptySources());
    expect(p.whatToDo).toEqual([]);
  });
});

describe("buildBriefingPayload — key changes → what changed (7-day window)", () => {
  it("reports weights logged + repro events when non-zero", () => {
    const sources = emptySources();
    sources.keyChanges.weightsLogged = 14;
    sources.keyChanges.reproEvents = 3;
    const p = buildBriefingPayload(sources);
    const joined = p.whatChanged.join(" ");
    expect(joined).toContain("14");
    expect(joined).toContain("weigh");
    expect(joined).toContain("3");
  });

  it("reports deaths and sales when non-zero, omits when zero", () => {
    const sources = emptySources();
    sources.keyChanges.deaths = 2;
    sources.keyChanges.sales = 0;
    const p = buildBriefingPayload(sources);
    const joined = p.whatChanged.join(" ");
    expect(joined).toContain("2");
    expect(joined.toLowerCase()).toContain("death");
    // zero sales must NOT produce a 'sales' line
    expect(joined.toLowerCase()).not.toContain("sold");
  });

  it("surfaces a drought/SPI line in what-to-watch when severity is dry", () => {
    const sources = emptySources();
    sources.keyChanges.drought = { spiSeverity: "severe-drought", currentMonth: "2026-05" };
    const p = buildBriefingPayload(sources);
    expect(p.whatToWatch.join(" ").toLowerCase()).toContain("drought");
  });

  it("does NOT surface drought when conditions are normal", () => {
    const sources = emptySources();
    sources.keyChanges.drought = { spiSeverity: "near-normal", currentMonth: "2026-05" };
    const p = buildBriefingPayload(sources);
    expect(p.whatToWatch.join(" ").toLowerCase()).not.toContain("drought");
  });

  it("surfaces declining/critical veld in what-to-watch, omits when healthy", () => {
    const sources = emptySources();
    sources.keyChanges.veld = { criticalCamps: 2, decliningCamps: 1 };
    const p = buildBriefingPayload(sources);
    expect(p.whatToWatch.join(" ").toLowerCase()).toContain("veld");

    const healthy = emptySources();
    healthy.keyChanges.veld = { criticalCamps: 0, decliningCamps: 0 };
    const ph = buildBriefingPayload(healthy);
    expect(ph.whatToWatch.join(" ").toLowerCase()).not.toContain("veld");
  });
});

describe("buildBriefingPayload — determinism", () => {
  it("is a pure function — same input yields identical output", () => {
    const sources = emptySources();
    sources.keyChanges.weightsLogged = 5;
    sources.attentionItems = [
      { animalId: "X", reasons: [{ id: "no-camp", severity: "amber", weight: 1 }], urgency: 1, severity: "amber", species: "cattle" },
    ];
    const a = buildBriefingPayload(sources);
    const b = buildBriefingPayload(sources);
    expect(a).toEqual(b);
  });
});
