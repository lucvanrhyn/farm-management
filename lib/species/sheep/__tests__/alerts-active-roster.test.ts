/**
 * @vitest-environment node
 *
 * sheepModule.getAlerts — every animal-derived alert count is the ACTIVE roster
 * only. Same leak class as the cattle poor-doer alert and Herd Triage:
 * `scoped().observation` carries NO status filter (observations persist after an
 * animal dies / sold), so an id-list harvested from observation history
 * (dosing, joining) includes deceased/sold animals. Each count MUST intersect
 * the active roster (`scoped().animal` injects status:Active) to stay in
 * lock-step with Herd Triage (lib/server/triage/get-triage.ts) — ADR-0010.
 *
 * Covers: sheep-dosing-due, sheep-lambing-imminent, sheep-lambing-overdue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  ewesCount: 0,
  activeAnimals: [] as unknown[],
  dosing: [] as unknown[],
  joining: [] as unknown[],
  lambing: [] as unknown[],
}));

// scoped(prisma, "sheep") reads: animal.count (ewes gate), animal.findMany
// (active roster), observation.findMany (dosing/joining/lambing/shearing).
vi.mock("@/lib/server/species-scoped-prisma", () => ({
  scoped: (_prisma: unknown, _mode: string) => ({
    animal: {
      count: vi.fn(() => Promise.resolve(mocks.ewesCount)),
      findMany: vi.fn(() => Promise.resolve(mocks.activeAnimals)),
    },
    observation: {
      findMany: vi.fn((args: { where?: { type?: string } }) => {
        const t = args?.where?.type;
        if (t === "dosing") return Promise.resolve(mocks.dosing);
        if (t === "joining") return Promise.resolve(mocks.joining);
        if (t === "lambing") return Promise.resolve(mocks.lambing);
        return Promise.resolve([]); // shearing → none (shearing-due fires; irrelevant here)
      }),
    },
  }),
}));

import { sheepModule } from "@/lib/species/sheep";

// Predation alert reads raw prisma.$queryRawUnsafe — stub it to 0 events.
function makePrisma() {
  return {
    $queryRawUnsafe: vi.fn(() => Promise.resolve([{ count: 0 }])),
  } as unknown as PrismaClient;
}

const DAY = 24 * 60 * 60 * 1000;
const OLD = new Date("2020-01-01T00:00:00Z"); // >90 days ago → dosing overdue
// Joined ~143 days ago → expected lambing (join+150d) is ~7 days out → imminent.
const joinedImminent = () => new Date(Date.now() - 143 * DAY);
// Joined 200 days ago (>160) with no lambing after → overdue to lamb.
const joinedOverdue = () => new Date(Date.now() - 200 * DAY);

const joinObs = (animalId: string, observedAt: Date) => ({
  animalId,
  campId: "C1",
  observedAt,
  details: "{}",
});

describe("sheepModule.getAlerts — active-roster intersection", () => {
  beforeEach(() => {
    mocks.ewesCount = 0;
    mocks.activeAnimals = [];
    mocks.dosing = [];
    mocks.joining = [];
    mocks.lambing = [];
  });

  // ── Dosing-due ─────────────────────────────────────────────────────────────
  it("counts an active sheep overdue for dosing", async () => {
    mocks.ewesCount = 1;
    mocks.activeAnimals = [{ animalId: "S2" }];
    mocks.dosing = [{ animalId: "S2", observedAt: OLD }];
    const alerts = await sheepModule.getAlerts(makePrisma(), "farm", {});
    expect(alerts.find((a) => a.id === "sheep-dosing-due")?.count).toBe(1);
  });

  it("does NOT count a deceased/sold ewe's stale dosing", async () => {
    mocks.ewesCount = 1;
    mocks.activeAnimals = [{ animalId: "S2" }]; // active = [S2]; no dosing record
    mocks.dosing = [{ animalId: "DEADEWE", observedAt: OLD }]; // overdue but not active
    const alerts = await sheepModule.getAlerts(makePrisma(), "farm", {});
    expect(alerts.find((a) => a.id === "sheep-dosing-due")).toBeUndefined();
  });

  // ── Lambing imminent ───────────────────────────────────────────────────────
  it("counts an active ewe due to lamb within 14 days", async () => {
    mocks.activeAnimals = [{ animalId: "E1" }];
    mocks.joining = [joinObs("E1", joinedImminent())];
    const alerts = await sheepModule.getAlerts(makePrisma(), "farm", {});
    expect(alerts.find((a) => a.id === "sheep-lambing-imminent")?.count).toBe(1);
  });

  it("does NOT count a deceased/sold ewe's joining as lambing-imminent", async () => {
    mocks.activeAnimals = [{ animalId: "E1" }]; // active = [E1]; E1 has no joining
    mocks.joining = [joinObs("DEADEWE", joinedImminent())]; // imminent but not active
    const alerts = await sheepModule.getAlerts(makePrisma(), "farm", {});
    expect(alerts.find((a) => a.id === "sheep-lambing-imminent")).toBeUndefined();
  });

  // ── Lambing overdue ────────────────────────────────────────────────────────
  it("counts an active ewe overdue to lamb", async () => {
    mocks.activeAnimals = [{ animalId: "E2" }];
    mocks.joining = [joinObs("E2", joinedOverdue())]; // >160d, no lambing after
    const alerts = await sheepModule.getAlerts(makePrisma(), "farm", {});
    expect(alerts.find((a) => a.id === "sheep-lambing-overdue")?.count).toBe(1);
  });

  it("does NOT count a deceased/sold ewe's joining as lambing-overdue", async () => {
    mocks.activeAnimals = [{ animalId: "E2" }]; // active = [E2]; E2 has no joining
    mocks.joining = [joinObs("DEADEWE", joinedOverdue())]; // overdue but not active
    const alerts = await sheepModule.getAlerts(makePrisma(), "farm", {});
    expect(alerts.find((a) => a.id === "sheep-lambing-overdue")).toBeUndefined();
  });
});
