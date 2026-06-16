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
}));

vi.mock("@/lib/server/treatment-analytics", () => ({
  getAnimalsInWithdrawal: vi.fn(() => Promise.resolve(mocks.withdrawal)),
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
      findMany: vi.fn((args: { where?: { type?: string } }) => {
        if (mode === "cattle" && args?.where?.type === "weighing") {
          return Promise.resolve(mocks.cattleWeighing);
        }
        if (mode === "sheep" && args?.where?.type === "dosing") {
          return Promise.resolve(mocks.sheepDosing);
        }
        return Promise.resolve([]);
      }),
    },
  }),
  crossSpecies: (_prisma: unknown, _reason: string) => ({}),
}));

import { getTriage } from "@/lib/server/triage/get-triage";

const THRESHOLDS = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  staleCampInspectionHours: 48,
};

// Minimal prisma stub — only farmSpeciesSettings.findMany is read directly.
function makePrisma() {
  return {
    farmSpeciesSettings: {
      findMany: vi.fn(() => Promise.resolve(mocks.speciesSettings)),
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

describe("getTriage", () => {
  beforeEach(() => {
    mocks.withdrawal = [];
    mocks.cattleAnimals = [];
    mocks.sheepAnimals = [];
    mocks.cattleWeighing = [];
    mocks.sheepDosing = [];
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
