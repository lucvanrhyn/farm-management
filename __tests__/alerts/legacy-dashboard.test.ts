/**
 * @vitest-environment node
 *
 * __tests__/alerts/legacy-dashboard.test.ts — wrapper round-trips legacy
 * alerts into AlertCandidate[]. We stub getDashboardAlerts via module mock.
 */

import { describe, it, expect, vi } from "vitest";
import { toAlertCandidate } from "@/lib/server/alerts/legacy-dashboard";

vi.mock("@/lib/server/dashboard-alerts", () => ({
  getDashboardAlerts: vi.fn(),
}));

import { getDashboardAlerts } from "@/lib/server/dashboard-alerts";
import { evaluate } from "@/lib/server/alerts/legacy-dashboard";
import { makePrisma, makeSettings } from "./fixtures";

describe("toAlertCandidate", () => {
  it("maps DashboardAlert → AlertCandidate with LEGACY_-prefixed type", () => {
    const cand = toAlertCandidate(
      {
        id: "poor-grazing",
        severity: "red",
        icon: "Tent",
        message: "2 camps with poor pasture",
        count: 2,
        href: "/x",
        species: "farm",
      },
      new Date("2026-04-19T00:00:00Z"),
    );
    expect(cand.type).toBe("LEGACY_POOR_GRAZING");
    expect(cand.category).toBe("veld");
    expect(cand.severity).toBe("red");
    expect(cand.dedupKey).toBe("LEGACY_POOR_GRAZING:farm:2026-04-19");
  });

  it("maps predator alerts to the predator category", () => {
    const cand = toAlertCandidate({
      id: "sheep-predation",
      severity: "amber",
      icon: "AlertTriangle",
      message: "3 predation events",
      count: 3,
      href: "/x",
      species: "sheep",
    });
    expect(cand.category).toBe("predator");
  });

  it("defaults unknown ids to performance category", () => {
    const cand = toAlertCandidate({
      id: "something-new",
      severity: "amber",
      icon: "X",
      message: "",
      count: 0,
      href: "/x",
      species: "farm",
    });
    expect(cand.category).toBe("performance");
  });
});

describe("evaluate() legacy-dashboard wrapper", () => {
  it("flattens red + amber from getDashboardAlerts into one list", async () => {
    vi.mocked(getDashboardAlerts).mockResolvedValue({
      red: [
        {
          id: "drought-severe",
          severity: "red",
          icon: "CloudOff",
          message: "SPI",
          count: 1,
          href: "/x",
          species: "farm",
        },
      ],
      amber: [
        {
          id: "stale-inspections",
          severity: "amber",
          icon: "ClipboardCheck",
          message: "2 camps",
          count: 2,
          href: "/x",
          species: "farm",
        },
      ],
      totalCount: 2,
    });
    const out = await evaluate(makePrisma(), makeSettings(), "tenant-a");
    expect(out).toHaveLength(2);
    const types = out.map((c) => c.type).sort();
    expect(types).toEqual(["LEGACY_DROUGHT_SEVERE", "LEGACY_STALE_INSPECTIONS"]);
  });

  it("returns [] gracefully when getDashboardAlerts throws", async () => {
    vi.mocked(getDashboardAlerts).mockRejectedValue(new Error("boom"));
    const out = await evaluate(makePrisma(), makeSettings(), "tenant-a");
    expect(out).toEqual([]);
  });
});
