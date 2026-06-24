/**
 * @vitest-environment node
 *
 * lib/server/triage/get-triage.ts — the Triage orchestrator.
 *
 * Mirrors dashboard-alerts' species-gate: iterates the SAME enabled per-
 * species modules (cattle always; sheep when enabled) — NEVER cattle-hard-
 * scoped (guards #356). Uses scoped()/crossSpecies() for reads, folds in the
 * cross-species in-withdrawal reason, and returns ranked AttentionItem[].
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock state (bare top-level mock consts hit TDZ) ──────────────────
const mocks = vi.hoisted(() => ({
  // animalId-keyed weighing sets / withdrawal results swapped per test.
  // WithdrawalAnimal carries the animal's TRUE species (looked up, not guessed).
  withdrawal: [] as Array<{ animalId: string; species: string }>,
  // per-species fetched animals (scoped)
  cattleAnimals: [] as unknown[],
  sheepAnimals: [] as unknown[],
  cattleWeighing: [] as unknown[],
  sheepDosing: [] as unknown[],
  speciesSettings: [] as Array<{ species: string; enabled: boolean }>,
  // open-cow source (reproduction-analytics.getReproStats) — DaysOpenRecord[].
  daysOpen: [] as Array<{ animalId: string; daysOpen: number | null; isExtended: boolean }>,
  // tag-keyed Transaction rows for the unprofitable detector.
  transactions: [] as Array<{ animalId: string; type: string; amount: number }>,
  // treatment/health observations (per scoped species) for repeated-treatments.
  cattleTreatments: [] as unknown[],
  sheepTreatments: [] as unknown[],
}));

vi.mock("@/lib/server/treatment-analytics", () => ({
  getAnimalsInWithdrawal: vi.fn(() => Promise.resolve(mocks.withdrawal)),
}));

vi.mock("@/lib/server/reproduction-analytics", () => ({
  getReproStats: vi.fn(() => Promise.resolve({ daysOpen: mocks.daysOpen })),
}));

// scoped(prisma, mode).animal.findMany / observation.findMany are driven by
// `mode`, so the facade is mocked to dispatch off the species argument.
vi.mock("@/lib/server/species-scoped-prisma", () => ({
  scoped: (_prisma: unknown, mode: string) => ({
    animal: {
      findMany: vi.fn(() =>
        Promise.resolve(mode === "cattle" ? mocks.cattleAnimals : mocks.sheepAnimals),
      ),
    },
    observation: {
      findMany: vi.fn((args: { where?: { type?: string | { in?: string[] } } }) => {
        const type = args?.where?.type;
        if (mode === "cattle" && type === "weighing") {
          return Promise.resolve(mocks.cattleWeighing);
        }
        if (mode === "sheep" && type === "dosing") {
          return Promise.resolve(mocks.sheepDosing);
        }
        // repeated-treatments reads `type: { in: [...] }` (treatment/dosing/…).
        if (type && typeof type === "object" && Array.isArray(type.in)) {
          return Promise.resolve(
            mode === "cattle" ? mocks.cattleTreatments : mocks.sheepTreatments,
          );
        }
        return Promise.resolve([]);
      }),
    },
  }),
  crossSpecies: (_prisma: unknown, _reason: string) => ({}),
}));

import {
  getTriage,
  detectUnprofitable,
  detectRepeatedTreatments,
  TREATMENT_OBS_TYPES,
} from "@/lib/server/triage/get-triage";
import { SHARED_OBSERVATION_TYPES } from "@/lib/species/types";

const THRESHOLDS = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  staleCampInspectionHours: 48,
  repeatedTreatmentCount: 3,
  repeatedTreatmentWindowDays: 90,
};

// Minimal prisma stub — farmSpeciesSettings.findMany (species gate) and
// transaction.findMany (unprofitable detector, tag-keyed) are read directly.
function makePrisma() {
  return {
    farmSpeciesSettings: {
      findMany: vi.fn(() => Promise.resolve(mocks.speciesSettings)),
    },
    transaction: {
      findMany: vi.fn(() => Promise.resolve(mocks.transactions)),
    },
  } as unknown as Parameters<typeof getTriage>[0];
}

const cattle = (animalId: string, over: Record<string, unknown> = {}) => ({
  animalId,
  species: "cattle",
  currentCamp: "C1",
  tagNumber: "1",
  brandSequence: null,
  dateOfBirth: "2024-01-01",
  category: "Heifer",
  ...over,
});

const sheep = (animalId: string, over: Record<string, unknown> = {}) => ({
  animalId,
  species: "sheep",
  currentCamp: "C1",
  tagNumber: "1",
  brandSequence: null,
  dateOfBirth: "2024-01-01",
  category: "Ewe",
  ...over,
});

describe("TREATMENT_OBS_TYPES (the repeated-treatments query filter)", () => {
  it("counts the canonical health-event type 'health_issue', never a non-existent 'health_check'", () => {
    // Regression (wave animal-mob-profitability): the filter listed
    // "health_check" — a type that is never persisted (the observation
    // allowlist rejects it), so every real health event was silently dropped
    // from the repeated-treatments count. The sanctioned health type is
    // "health_issue".
    expect(TREATMENT_OBS_TYPES).toContain("health_issue");
    expect(TREATMENT_OBS_TYPES).not.toContain("health_check");
  });

  it("only filters on sanctioned observation types", () => {
    // 'dosing' is sheep-exclusive (lib/species/sheep/config.ts); the rest are
    // shared. A typo'd / non-existent type would match zero rows in prod.
    const valid = new Set([...SHARED_OBSERVATION_TYPES.map((t) => t.value), "dosing"]);
    for (const t of TREATMENT_OBS_TYPES) {
      expect(valid.has(t)).toBe(true);
    }
  });
});

describe("getTriage", () => {
  beforeEach(() => {
    mocks.withdrawal = [];
    mocks.cattleAnimals = [];
    mocks.sheepAnimals = [];
    mocks.cattleWeighing = [];
    mocks.sheepDosing = [];
    mocks.daysOpen = [];
    mocks.transactions = [];
    mocks.cattleTreatments = [];
    mocks.sheepTreatments = [];
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: false },
      { species: "game", enabled: false },
    ];
  });

  it("returns ranked AttentionItem[] from cattle snapshot findings", async () => {
    mocks.cattleAnimals = [cattle("A1", { currentCamp: "" }), cattle("A2")];
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    expect(items.map((i) => i.animalId)).toContain("A1");
    // A2 is fully populated → no findings → absent
    expect(items.find((i) => i.animalId === "A2")).toBeUndefined();
    expect(items[0].reasons.some((r) => r.id === "no-camp")).toBe(true);
  });

  it("folds in cross-species in-withdrawal as a RED reason", async () => {
    mocks.cattleAnimals = [cattle("W1")];
    mocks.withdrawal = [{ animalId: "W1", species: "cattle" }];
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    const w1 = items.find((i) => i.animalId === "W1");
    expect(w1).toBeDefined();
    expect(w1?.severity).toBe("red");
    expect(w1?.reasons.some((r) => r.id === "in-withdrawal")).toBe(true);
  });

  it("tags a withdrawal-ONLY animal with its TRUE species, not a guess", async () => {
    // Sheep enabled; the sheep withdrawal animal has NO other finding, so it is
    // absent from speciesByAnimal. It must still be tagged 'sheep' (its real
    // species), never defaulted to cattle.
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: true },
    ];
    mocks.withdrawal = [{ animalId: "WS1", species: "sheep" }];
    const items = await getTriage(makePrisma(), "mixed", THRESHOLDS);
    const ws1 = items.find((i) => i.animalId === "WS1");
    expect(ws1).toBeDefined();
    expect(ws1?.species).toBe("sheep");
  });

  it("does NOT leak a GAME withdrawal animal onto triage (mislabeled cattle) — #356 guard", async () => {
    // Game has individual Animal rows that can be treated, but is population-
    // tracked → never per-animal-triaged. A game animal in withdrawal with no
    // other finding must be DROPPED, not surfaced as species:'cattle'.
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: true },
      { species: "game", enabled: true },
    ];
    mocks.withdrawal = [{ animalId: "GAME-1", species: "game" }];
    const items = await getTriage(makePrisma(), "multi", THRESHOLDS);
    expect(items.find((i) => i.animalId === "GAME-1")).toBeUndefined();
  });

  it("does NOT mislabel a cattle withdrawal animal as sheep when mode='sheep'", async () => {
    // mode narrows enabledSpecies to ['sheep']; a cattle withdrawal-only animal
    // must be DROPPED, never surfaced tagged species:'sheep'.
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: true },
    ];
    mocks.withdrawal = [{ animalId: "WC1", species: "cattle" }];
    const items = await getTriage(makePrisma(), "mixed", THRESHOLDS, "sheep");
    expect(items.find((i) => i.animalId === "WC1")).toBeUndefined();
  });

  it("does NOT leak a SHEEP withdrawal animal onto a cattle-only farm", async () => {
    // cattle-only enabled; a sheep animal in withdrawal must be dropped, not
    // surfaced as species:'cattle' (#356 mislabel class).
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: false },
      { species: "game", enabled: false },
    ];
    mocks.withdrawal = [{ animalId: "WSX", species: "sheep" }];
    const items = await getTriage(makePrisma(), "cattle-only", THRESHOLDS);
    expect(items.find((i) => i.animalId === "WSX")).toBeUndefined();
  });

  it("does NOT surface sheep reasons on a cattle-only farm (#203 / #356 guard)", async () => {
    mocks.sheepAnimals = [sheep("S1", { currentCamp: "" })];
    mocks.sheepDosing = [];
    const items = await getTriage(makePrisma(), "cattle-only", THRESHOLDS);
    expect(items.find((i) => i.animalId === "S1")).toBeUndefined();
  });

  it("surfaces sheep reasons when sheep is enabled", async () => {
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: true },
      { species: "game", enabled: false },
    ];
    mocks.sheepAnimals = [sheep("S1", { currentCamp: "" })];
    const items = await getTriage(makePrisma(), "mixed", THRESHOLDS);
    const s1 = items.find((i) => i.animalId === "S1");
    expect(s1).toBeDefined();
    expect(s1?.species).toBe("sheep");
  });

  it("projects sheep dosing-overdue as a finding (active ewes present)", async () => {
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: true },
    ];
    mocks.sheepAnimals = [sheep("S2")]; // category 'Ewe' → gate open
    mocks.sheepDosing = [{ animalId: "S2", observedAt: new Date("2020-01-01T00:00:00Z") }];
    const items = await getTriage(makePrisma(), "mixed", THRESHOLDS);
    const s2 = items.find((i) => i.animalId === "S2");
    expect(s2?.reasons.some((r) => r.id === "dosing-overdue")).toBe(true);
  });

  it("does NOT surface dosing-overdue when there are no active ewes (shares the alert's ewesCount gate)", async () => {
    // The sheep `sheep-dosing-due` alert only fires when active Ewe/Maiden Ewe
    // count > 0. Triage MUST share that population — a ram/wether-only flock
    // with stale-dosed sheep shows zero dosing-due on the dashboard, so Triage
    // must not surface dosing-overdue either (ADR-0010 same-population).
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: true },
    ];
    mocks.sheepAnimals = [sheep("R1", { category: "Ram" })];
    mocks.sheepDosing = [{ animalId: "R1", observedAt: new Date("2020-01-01T00:00:00Z") }];
    const items = await getTriage(makePrisma(), "mixed", THRESHOLDS);
    const r1 = items.find((i) => i.animalId === "R1");
    expect(r1?.reasons.some((r) => r.id === "dosing-overdue")).toBeFalsy();
  });

  it("projects cattle poor-doer as a finding", async () => {
    mocks.cattleAnimals = [cattle("P1")];
    mocks.cattleWeighing = [
      { animalId: "P1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
      { animalId: "P1", observedAt: new Date("2026-04-11T00:00:00Z"), details: JSON.stringify({ weight_kg: 410 }) },
    ];
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    const p1 = items.find((i) => i.animalId === "P1");
    expect(p1?.reasons.some((r) => r.id === "poor-doer")).toBe(true);
  });

  it("does NOT surface poor-doer for a non-active cattle animal that still has historical weighings", async () => {
    // Observations persist after an animal dies / is sold, and scoped()
    // observation reads carry NO status filter — so the weighing history
    // contains a deceased animal's old weights. Its declining ADG must NOT
    // surface it on triage: triage is the ACTIVE population only (the animals
    // returned by scoped().animal.findMany, which injects status:Active).
    mocks.cattleAnimals = [cattle("P1")]; // active herd = [P1] only
    mocks.cattleWeighing = [
      // P1 — healthy ADG (1.0 kg/d) → no finding
      { animalId: "P1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
      { animalId: "P1", observedAt: new Date("2026-04-11T00:00:00Z"), details: JSON.stringify({ weight_kg: 500 }) },
      // DEAD1 — poor ADG (0.1 kg/d) but NOT in the active set
      { animalId: "DEAD1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
      { animalId: "DEAD1", observedAt: new Date("2026-04-11T00:00:00Z"), details: JSON.stringify({ weight_kg: 410 }) },
    ];
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    expect(items.find((i) => i.animalId === "DEAD1")).toBeUndefined();
  });

  it("does NOT surface dosing-overdue for a non-active ewe that still has historical dosing", async () => {
    // Same leak class on the sheep history path: a deceased/sold ewe's stale
    // dosing observation must not surface her on triage even with active ewes
    // present (gate open). Only the active population is triaged.
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: true },
    ];
    mocks.sheepAnimals = [sheep("S2")]; // active ewe → dosing gate open
    mocks.sheepDosing = [
      { animalId: "DEADEWE", observedAt: new Date("2020-01-01T00:00:00Z") }, // overdue, NOT active
    ];
    const items = await getTriage(makePrisma(), "mixed", THRESHOLDS);
    expect(items.find((i) => i.animalId === "DEADEWE")).toBeUndefined();
  });

  it("projects open-cow from the LIVE tag-keyed repro engine (days-open beyond limit)", async () => {
    // getReproStats is tag-keyed (NOT the dead cuid-filter repro-engine.ts), so
    // its daysOpen[].animalId is the TAG and joins to the active roster.
    mocks.cattleAnimals = [cattle("OPEN1"), cattle("OK1")];
    mocks.cattleWeighing = [
      { animalId: "OPEN1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
      { animalId: "OK1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
    ];
    mocks.daysOpen = [
      { animalId: "OPEN1", daysOpen: 400, isExtended: true }, // > daysOpenLimit 365
      { animalId: "OK1", daysOpen: 60, isExtended: false },
    ];
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    const open1 = items.find((i) => i.animalId === "OPEN1");
    expect(open1?.reasons.some((r) => r.id === "open-cow")).toBe(true);
    expect(items.find((i) => i.animalId === "OK1")).toBeUndefined();
  });

  it("flags open-cow when conception is unconfirmed (daysOpen null + isExtended)", async () => {
    mocks.cattleAnimals = [cattle("NOCONC")];
    mocks.cattleWeighing = [
      { animalId: "NOCONC", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
    ];
    mocks.daysOpen = [{ animalId: "NOCONC", daysOpen: null, isExtended: true }];
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    expect(items.find((i) => i.animalId === "NOCONC")?.reasons.some((r) => r.id === "open-cow")).toBe(true);
  });

  it("does NOT surface open-cow for a non-active cow with a stale open record", async () => {
    mocks.cattleAnimals = [cattle("LIVE1")]; // active herd = [LIVE1]
    mocks.cattleWeighing = [
      { animalId: "LIVE1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
    ];
    mocks.daysOpen = [{ animalId: "SOLD1", daysOpen: 500, isExtended: true }]; // not active
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    expect(items.find((i) => i.animalId === "SOLD1")).toBeUndefined();
  });

  it("projects unprofitable (negative margin) as an ADVISORY finding", async () => {
    mocks.cattleAnimals = [cattle("LOSS1"), cattle("WIN1")];
    mocks.cattleWeighing = [
      { animalId: "LOSS1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
      { animalId: "WIN1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
    ];
    mocks.transactions = [
      { animalId: "LOSS1", type: "expense", amount: 1000 }, // margin -1000
      { animalId: "WIN1", type: "income", amount: 5000 },   // margin +5000
      { animalId: "WIN1", type: "expense", amount: 500 },
    ];
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    const loss1 = items.find((i) => i.animalId === "LOSS1");
    expect(loss1?.reasons.some((r) => r.id === "unprofitable")).toBe(true);
    expect(loss1?.advisory).toBeTruthy(); // projected, not banked
    // WIN1 has positive margin and is the category max → not flagged.
    expect(items.find((i) => i.animalId === "WIN1")?.reasons.some((r) => r.id === "unprofitable")).toBeFalsy();
  });

  it("does NOT flag unprofitable for an animal with NO tagged transaction (unfed data)", async () => {
    mocks.cattleAnimals = [cattle("UNTOUCHED")];
    mocks.cattleWeighing = [
      { animalId: "UNTOUCHED", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
    ];
    mocks.transactions = []; // nothing tagged
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    expect(items.find((i) => i.animalId === "UNTOUCHED")?.reasons.some((r) => r.id === "unprofitable")).toBeFalsy();
  });

  it("projects repeated-treatments when count ≥ threshold inside the window", async () => {
    const recent = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    mocks.cattleAnimals = [cattle("SICK1"), cattle("WELL1")];
    mocks.cattleWeighing = [
      { animalId: "SICK1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
      { animalId: "WELL1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
    ];
    mocks.cattleTreatments = [
      { animalId: "SICK1", observedAt: recent(5) },
      { animalId: "SICK1", observedAt: recent(20) },
      { animalId: "SICK1", observedAt: recent(60) }, // 3 within 90d → flag
      { animalId: "WELL1", observedAt: recent(5) },  // 1 → no flag
      { animalId: "SICK1", observedAt: recent(200) }, // outside window — ignored
    ];
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    expect(items.find((i) => i.animalId === "SICK1")?.reasons.some((r) => r.id === "repeated-treatments")).toBe(true);
    expect(items.find((i) => i.animalId === "WELL1")?.reasons.some((r) => r.id === "repeated-treatments")).toBeFalsy();
  });

  it("does NOT surface repeated-treatments for a non-active animal with stale treatments", async () => {
    const recent = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    mocks.cattleAnimals = [cattle("LIVE2")];
    mocks.cattleWeighing = [
      { animalId: "LIVE2", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
    ];
    mocks.cattleTreatments = [
      { animalId: "DEAD2", observedAt: recent(5) },
      { animalId: "DEAD2", observedAt: recent(10) },
      { animalId: "DEAD2", observedAt: recent(15) }, // 3 but NOT active
    ];
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    expect(items.find((i) => i.animalId === "DEAD2")).toBeUndefined();
  });

  it("returns [] for an all-clean herd", async () => {
    mocks.cattleAnimals = [cattle("OK1"), cattle("OK2")];
    // some animal weighed so no-weight isn't suppressed-but-firing for all
    mocks.cattleWeighing = [
      { animalId: "OK1", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
      { animalId: "OK2", observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: 400 }) },
    ];
    const items = await getTriage(makePrisma(), "farm", THRESHOLDS);
    expect(items).toEqual([]);
  });
});

describe("detectUnprofitable (pure)", () => {
  const tx = (animalId: string, type: string, amount: number) => ({ animalId, type, amount });

  it("flags a negative-margin animal regardless of cohort size", () => {
    const animals = [{ animalId: "A", category: "Heifer" }];
    const flagged = detectUnprofitable(animals, [tx("A", "expense", 800)]);
    expect(flagged).toEqual(["A"]);
  });

  it("does NOT flag a lone PROFITABLE animal (no meaningful quartile under 4)", () => {
    const animals = [{ animalId: "P", category: "Heifer" }];
    const flagged = detectUnprofitable(animals, [tx("P", "income", 500)]);
    expect(flagged).toEqual([]);
  });

  it("skips animals with NO tagged transaction (unfed data, not a loss)", () => {
    const animals = [
      { animalId: "TOUCHED", category: "Cow" },
      { animalId: "UNTOUCHED", category: "Cow" },
    ];
    const flagged = detectUnprofitable(animals, [tx("TOUCHED", "expense", 100)]);
    expect(flagged).toContain("TOUCHED");
    expect(flagged).not.toContain("UNTOUCHED");
  });

  it("applies the bottom-quartile cut category-relatively once cohort ≥4", () => {
    // Cohort of 4 profitable Cows: margins 100/200/300/400. floor(4/4)-1 = 0 →
    // quartile = the worst (100). Only that animal is bottom-quartile; the rest
    // are profitable and above the cut.
    const animals = [
      { animalId: "C1", category: "Cow" },
      { animalId: "C2", category: "Cow" },
      { animalId: "C3", category: "Cow" },
      { animalId: "C4", category: "Cow" },
    ];
    const taggedTx = [
      tx("C1", "income", 100),
      tx("C2", "income", 200),
      tx("C3", "income", 300),
      tx("C4", "income", 400),
    ];
    const flagged = detectUnprofitable(animals, taggedTx);
    expect(flagged).toEqual(["C1"]);
  });

  it("isolates cohorts BY CATEGORY (a calf's low margin doesn't drag a bull)", () => {
    // Bull B (margin 50) is profitable and alone in its category → not flagged.
    // The Calf cohort is its own quartile pool.
    const animals = [
      { animalId: "B", category: "Bull" },
      { animalId: "K1", category: "Calf" },
      { animalId: "K2", category: "Calf" },
      { animalId: "K3", category: "Calf" },
      { animalId: "K4", category: "Calf" },
    ];
    const taggedTx = [
      tx("B", "income", 50),
      tx("K1", "income", 10),
      tx("K2", "income", 20),
      tx("K3", "income", 30),
      tx("K4", "income", 40),
    ];
    const flagged = detectUnprofitable(animals, taggedTx);
    expect(flagged).not.toContain("B");
    expect(flagged).toEqual(["K1"]);
  });
});

describe("detectRepeatedTreatments (pure)", () => {
  const NOW = new Date("2026-06-19T00:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  it("flags when count ≥ threshold inside the window", () => {
    const obs = [
      { animalId: "X", observedAt: daysAgo(5) },
      { animalId: "X", observedAt: daysAgo(30) },
      { animalId: "X", observedAt: daysAgo(80) },
    ];
    expect(detectRepeatedTreatments(obs, 90, 3, NOW)).toEqual(["X"]);
  });

  it("ignores treatments OUTSIDE the rolling window", () => {
    const obs = [
      { animalId: "X", observedAt: daysAgo(5) },
      { animalId: "X", observedAt: daysAgo(30) },
      { animalId: "X", observedAt: daysAgo(120) }, // outside 90d
    ];
    expect(detectRepeatedTreatments(obs, 90, 3, NOW)).toEqual([]);
  });

  it("does not flag below the count threshold", () => {
    const obs = [
      { animalId: "Y", observedAt: daysAgo(1) },
      { animalId: "Y", observedAt: daysAgo(2) },
    ];
    expect(detectRepeatedTreatments(obs, 90, 3, NOW)).toEqual([]);
  });

  it("respects a custom threshold/window", () => {
    const obs = [
      { animalId: "Z", observedAt: daysAgo(1) },
      { animalId: "Z", observedAt: daysAgo(5) },
    ];
    expect(detectRepeatedTreatments(obs, 30, 2, NOW)).toEqual(["Z"]);
  });
});
