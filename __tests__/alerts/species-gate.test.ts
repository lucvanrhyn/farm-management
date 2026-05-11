/**
 * @vitest-environment node
 *
 * __tests__/alerts/species-gate.test.ts — Regression for issue #203.
 *
 * Root cause: `lib/server/dashboard-alerts.ts` iterated a hardcoded
 * [cattleModule, sheepModule, gameModule] regardless of which species the farm
 * had enabled. Result: sheep alerts (e.g. "sheep-shearing-due") fired on
 * cattle-only farms.
 *
 * Fix: gate the species iteration on the farm's FarmSpeciesSettings rows so
 * only the enabled species contribute alerts. Cattle is always included as a
 * safe default (matches getCachedFarmSpeciesSettings semantics).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted module mocks (vi.mock factories run before module-level consts) ──
const mocks = vi.hoisted(() => ({
  cattleGetAlerts: vi.fn(),
  sheepGetAlerts: vi.fn(),
  gameGetAlerts: vi.fn(),
}));

vi.mock("@/lib/species/cattle", () => ({
  cattleModule: {
    config: { id: "cattle" },
    getAlerts: mocks.cattleGetAlerts,
  },
}));

vi.mock("@/lib/species/sheep", () => ({
  sheepModule: {
    config: { id: "sheep" },
    getAlerts: mocks.sheepGetAlerts,
  },
}));

vi.mock("@/lib/species/game", () => ({
  gameModule: {
    config: { id: "game" },
    getAlerts: mocks.gameGetAlerts,
  },
}));

// ── Mock farm-wide data sources so we can focus on the species-gate path ─────
vi.mock("@/lib/server/treatment-analytics", () => ({
  getAnimalsInWithdrawal: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/server/camp-status", () => ({
  getLatestCampConditions: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/server/rotation-engine", () => ({
  getRotationStatusByCamp: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/server/veld-score", () => ({
  getFarmSummary: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/server/feed-on-offer", () => ({
  getFarmFeedOnOfferPayload: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/server/drought", () => ({
  getDroughtPayload: vi.fn().mockResolvedValue(null),
}));

import { getDashboardAlerts } from "@/lib/server/dashboard-alerts";
import { makePrisma } from "./fixtures";

const THRESHOLDS = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  staleCampInspectionHours: 48,
};

describe("getDashboardAlerts — species-gate (issue #203)", () => {
  beforeEach(() => {
    mocks.cattleGetAlerts.mockReset().mockResolvedValue([]);
    mocks.sheepGetAlerts.mockReset().mockResolvedValue([
      {
        id: "sheep-shearing-due",
        severity: "amber",
        icon: "Scissors",
        message: "Shearing due",
        count: 1,
        href: "/cattle-only-farm/sheep",
      },
    ]);
    mocks.gameGetAlerts.mockReset().mockResolvedValue([]);
  });

  it("does not emit sheep alerts on a cattle-only farm", async () => {
    const prisma = makePrisma({
      farmSpeciesSettings: {
        findMany: vi.fn().mockResolvedValue([
          { species: "cattle", enabled: true },
          { species: "sheep", enabled: false },
          { species: "game", enabled: false },
        ]),
      },
    });

    const result = await getDashboardAlerts(
      prisma,
      "cattle-only-farm",
      THRESHOLDS,
    );

    const allAlertIds = [...result.red, ...result.amber].map((a) => a.id);
    expect(allAlertIds).not.toContain("sheep-shearing-due");
    expect(mocks.sheepGetAlerts).not.toHaveBeenCalled();
    expect(mocks.gameGetAlerts).not.toHaveBeenCalled();
    expect(mocks.cattleGetAlerts).toHaveBeenCalledTimes(1);
  });

  it("emits sheep alerts when sheep is enabled on the farm", async () => {
    const prisma = makePrisma({
      farmSpeciesSettings: {
        findMany: vi.fn().mockResolvedValue([
          { species: "cattle", enabled: true },
          { species: "sheep", enabled: true },
          { species: "game", enabled: false },
        ]),
      },
    });

    const result = await getDashboardAlerts(
      prisma,
      "mixed-farm",
      THRESHOLDS,
    );

    const allAlertIds = [...result.red, ...result.amber].map((a) => a.id);
    expect(allAlertIds).toContain("sheep-shearing-due");
    expect(mocks.sheepGetAlerts).toHaveBeenCalledTimes(1);
    expect(mocks.gameGetAlerts).not.toHaveBeenCalled();
  });

  it("falls back to cattle-only when farmSpeciesSettings lookup fails", async () => {
    const prisma = makePrisma({
      farmSpeciesSettings: {
        findMany: vi.fn().mockRejectedValue(new Error("db down")),
      },
    });

    const result = await getDashboardAlerts(
      prisma,
      "any-farm",
      THRESHOLDS,
    );

    const allAlertIds = [...result.red, ...result.amber].map((a) => a.id);
    expect(allAlertIds).not.toContain("sheep-shearing-due");
    expect(mocks.sheepGetAlerts).not.toHaveBeenCalled();
    expect(mocks.gameGetAlerts).not.toHaveBeenCalled();
    expect(mocks.cattleGetAlerts).toHaveBeenCalledTimes(1);
  });
});
