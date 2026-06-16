/**
 * @vitest-environment node
 *
 * lib/server/triage/__tests__/species-gate.test.ts — Triage's mirror of
 * __tests__/alerts/species-gate.test.ts (issue #203 / #356).
 *
 * Triage MUST iterate the SAME enabled per-species modules as the alert fan-out
 * (cattle always; sheep only when enabled) — never cattle-hard-scoped. This
 * locks: sheep reasons never appear on a cattle-only farm, and DO appear once
 * sheep is enabled.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  speciesSettings: [] as Array<{ species: string; enabled: boolean }>,
  // animalId → species set of fetched animals, keyed by scoped(mode)
  cattleAnimals: [] as unknown[],
  sheepAnimals: [] as unknown[],
  scopedCalls: [] as string[],
}));

vi.mock("@/lib/server/treatment-analytics", () => ({
  getAnimalsInWithdrawal: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/server/species-scoped-prisma", () => ({
  scoped: (_p: unknown, mode: string) => {
    mocks.scopedCalls.push(mode);
    return {
      animal: {
        findMany: vi.fn(() =>
          Promise.resolve(mode === "cattle" ? mocks.cattleAnimals : mocks.sheepAnimals),
        ),
      },
      observation: { findMany: vi.fn(() => Promise.resolve([])) },
    };
  },
  crossSpecies: () => ({}),
}));

import { getTriage } from "@/lib/server/triage/get-triage";

const THRESHOLDS = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  staleCampInspectionHours: 48,
};

function makePrisma() {
  return {
    farmSpeciesSettings: {
      findMany: vi.fn(() => Promise.resolve(mocks.speciesSettings)),
    },
  } as unknown as Parameters<typeof getTriage>[0];
}

const sheep = (animalId: string) => ({
  animalId,
  species: "sheep",
  currentCamp: "", // would fire no-camp IF sheep were triaged
  tagNumber: "1",
  brandSequence: null,
  dateOfBirth: "2024-01-01",
  category: "Ewe",
});

describe("getTriage — species-gate (#203 / #356)", () => {
  beforeEach(() => {
    mocks.scopedCalls = [];
    mocks.cattleAnimals = [];
    mocks.sheepAnimals = [sheep("S1")];
  });

  it("does NOT triage sheep on a cattle-only farm (no sheep scoped read, no sheep item)", async () => {
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: false },
      { species: "game", enabled: false },
    ];
    const items = await getTriage(makePrisma(), "cattle-only-farm", THRESHOLDS);
    expect(items.find((i) => i.species === "sheep")).toBeUndefined();
    expect(items.find((i) => i.animalId === "S1")).toBeUndefined();
    expect(mocks.scopedCalls).not.toContain("sheep");
    expect(mocks.scopedCalls).toContain("cattle");
  });

  it("triages sheep once sheep is enabled", async () => {
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "sheep", enabled: true },
      { species: "game", enabled: false },
    ];
    const items = await getTriage(makePrisma(), "mixed-farm", THRESHOLDS);
    expect(items.find((i) => i.animalId === "S1")).toBeDefined();
    expect(mocks.scopedCalls).toContain("sheep");
  });

  it("never triages game (population-tracked) even if enabled", async () => {
    mocks.speciesSettings = [
      { species: "cattle", enabled: true },
      { species: "game", enabled: true },
    ];
    await getTriage(makePrisma(), "game-farm", THRESHOLDS);
    expect(mocks.scopedCalls).not.toContain("game");
  });

  it("falls back to cattle-only when farmSpeciesSettings lookup fails (never sheep)", async () => {
    const prisma = {
      farmSpeciesSettings: {
        findMany: vi.fn(() => Promise.reject(new Error("db down"))),
      },
    } as unknown as Parameters<typeof getTriage>[0];
    const items = await getTriage(prisma, "any-farm", THRESHOLDS);
    expect(items.find((i) => i.species === "sheep")).toBeUndefined();
    expect(mocks.scopedCalls).not.toContain("sheep");
  });
});
