/**
 * @vitest-environment node
 *
 * cattleModule.getAlerts — the "poor-doers" count is the ACTIVE roster only.
 *
 * The dashboard "poor-doers" alert COUNTs `detectPoorDoers(weighingHistory)`.
 * `scoped().observation` carries NO status filter (observations persist after
 * an animal dies / is sold — see lib/server/species-scoped-prisma.ts), so the
 * weighing history includes deceased/sold animals' retained weights. The count
 * MUST intersect the active roster (`scoped().animal` injects status:Active),
 * otherwise it diverges from Herd Triage — which already intersects (see
 * lib/server/triage/get-triage.ts) — breaking the same-population invariant
 * (ADR-0010 / lib/server/triage/__tests__/same-population.test.ts).
 *
 * Sibling of get-triage.test.ts's "does NOT surface poor-doer for a non-active
 * cattle animal that still has historical weighings".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

// ── Hoisted mock state (bare top-level mock consts hit TDZ) ──────────────────
const mocks = vi.hoisted(() => ({
  cattleAnimals: [] as unknown[],
  cattleWeighing: [] as unknown[],
}));

// Repro engine is its own DB read; stub it so this test isolates the poor-doer
// path. Empty repro stats → no calving / open-cow alerts.
vi.mock("@/lib/species/shared/repro-engine", () => ({
  getReproStatsForSpecies: vi.fn(() =>
    Promise.resolve({ upcomingBirths: [], daysOpen: [] }),
  ),
}));

// scoped(prisma, "cattle").{animal,observation}.findMany are the only reads
// getAlerts makes for the poor-doer path.
vi.mock("@/lib/server/species-scoped-prisma", () => ({
  scoped: (_prisma: unknown, _mode: string) => ({
    animal: {
      findMany: vi.fn(() => Promise.resolve(mocks.cattleAnimals)),
    },
    observation: {
      findMany: vi.fn(() => Promise.resolve(mocks.cattleWeighing)),
    },
  }),
}));

import { cattleModule } from "@/lib/species/cattle";

const THRESHOLDS = { adgPoorDoerThreshold: 0.7, calvingAlertDays: 14, daysOpenLimit: 365 };
const prisma = {} as unknown as PrismaClient;

/** Two weighings: w1 → w2 over 100 days. 0.1 kg/d (=10kg) is a poor doer at 0.7. */
const weigh = (animalId: string, w1: number, w2: number) => [
  { animalId, observedAt: new Date("2026-01-01T00:00:00Z"), details: JSON.stringify({ weight_kg: w1 }) },
  { animalId, observedAt: new Date("2026-04-11T00:00:00Z"), details: JSON.stringify({ weight_kg: w2 }) },
];

describe("cattleModule.getAlerts — poor-doer active-roster intersection", () => {
  beforeEach(() => {
    mocks.cattleAnimals = [];
    mocks.cattleWeighing = [];
  });

  it("counts a poor-doer that IS in the active roster", async () => {
    mocks.cattleAnimals = [{ animalId: "P1" }];
    mocks.cattleWeighing = weigh("P1", 400, 410); // +10kg/100d = 0.1 kg/d → poor doer
    const alerts = await cattleModule.getAlerts(prisma, "farm", THRESHOLDS);
    expect(alerts.find((a) => a.id === "poor-doers")?.count).toBe(1);
  });

  it("does NOT count a deceased/sold animal's stale weighings", async () => {
    mocks.cattleAnimals = [{ animalId: "P1" }]; // active herd = [P1] only
    mocks.cattleWeighing = [
      ...weigh("P1", 400, 500), // healthy 1.0 kg/d → not a poor doer
      ...weigh("DEAD1", 400, 410), // poor 0.1 kg/d BUT not in the active roster
    ];
    const alerts = await cattleModule.getAlerts(prisma, "farm", THRESHOLDS);
    // Zero ACTIVE poor doers → the alert must not fire at all.
    expect(alerts.find((a) => a.id === "poor-doers")).toBeUndefined();
  });

  it("counts only the active subset when both active and deceased are poor doers", async () => {
    mocks.cattleAnimals = [{ animalId: "P1" }]; // active herd = [P1] only
    mocks.cattleWeighing = [
      ...weigh("P1", 400, 410), // active poor doer
      ...weigh("DEAD1", 400, 410), // deceased poor doer — must be excluded
    ];
    const alerts = await cattleModule.getAlerts(prisma, "farm", THRESHOLDS);
    expect(alerts.find((a) => a.id === "poor-doers")?.count).toBe(1);
  });
});
