/**
 * @vitest-environment node
 *
 * ADR-0005 — table tests for the pure alert-composition core.
 *
 * `composeAlerts(inputs)` is the *single* place alert severity, messages and
 * counts are decided. Every source is independently optional; an absent
 * source contributes nothing (an absent source and a clean source produce
 * the same output, by design). These cases pin one alert type per source so
 * a future regression in any severity branch is caught at the unit level —
 * no Prisma double / seeded tenant required.
 */
import { describe, it, expect } from "vitest";
import {
  composeAlerts,
  type AlertInputs,
} from "@/lib/server/alerts/compose";
import type { AlertThresholds } from "@/lib/server/dashboard-alerts";
import type { LiveCampStatus } from "@/lib/server/camp-status";

const THRESHOLDS: AlertThresholds = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  staleCampInspectionHours: 48,
};

const NOW = new Date("2026-05-17T12:00:00.000Z");
const FARM = "demo-farm";

function base(over: Partial<AlertInputs> = {}): AlertInputs {
  return { thresholds: THRESHOLDS, farmSlug: FARM, now: NOW, ...over };
}

function camp(over: Partial<LiveCampStatus> = {}): LiveCampStatus {
  return {
    grazing_quality: "Good",
    water_status: "Full",
    fence_status: "Intact",
    // Fresh: inspected 1h ago, well within the 48h stale window.
    last_inspected_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    last_inspected_by: "tester",
    ...over,
  };
}

function ids(list: { id: string }[]): string[] {
  return list.map((a) => a.id).sort();
}

describe("composeAlerts — empty / total inputs", () => {
  it("no sources → empty alert set", () => {
    const out = composeAlerts(base());
    expect(out.red).toEqual([]);
    expect(out.amber).toEqual([]);
    expect(out.totalCount).toBe(0);
  });

  it("absent source contributes nothing (clean == absent)", () => {
    const out = composeAlerts(
      base({ campConditions: new Map([["c1", camp()]]), totalCamps: 1 }),
    );
    expect(out.totalCount).toBe(0);
  });
});

describe("composeAlerts — camp-conditions source", () => {
  it("poor grazing → red poor-grazing", () => {
    const out = composeAlerts(
      base({
        campConditions: new Map([
          ["c1", camp({ grazing_quality: "Poor" })],
          ["c2", camp({ grazing_quality: "Overgrazed" })],
        ]),
        totalCamps: 2,
      }),
    );
    const a = out.red.find((x) => x.id === "poor-grazing");
    expect(a).toBeDefined();
    expect(a!.count).toBe(2);
    expect(a!.severity).toBe("red");
    expect(a!.message).toBe("2 camps with poor or overgrazed pasture");
    expect(a!.href).toBe(`/${FARM}/admin/performance`);
  });

  it("stale inspection → amber stale-inspections (aged + uninspected)", () => {
    const stale = camp({
      last_inspected_at: new Date(
        NOW.getTime() - 72 * 60 * 60 * 1000,
      ).toISOString(),
    });
    const out = composeAlerts(
      base({
        campConditions: new Map([["c1", stale]]),
        // 3 total camps, only 1 has a condition → 2 uninspected + 1 aged = 3
        totalCamps: 3,
      }),
    );
    const a = out.amber.find((x) => x.id === "stale-inspections");
    expect(a).toBeDefined();
    expect(a!.count).toBe(3);
    expect(a!.message).toBe("3 camps not inspected within 48h");
  });
});

describe("composeAlerts — fence (camp-conditions source, ADR-0005 §4)", () => {
  it("non-Intact fence → amber fence-damaged, pluralised, camps href", () => {
    const out = composeAlerts(
      base({
        campConditions: new Map([
          ["c1", camp({ fence_status: "Damaged" })],
          ["c2", camp({ fence_status: "Damaged" })],
          ["c3", camp()], // Intact — no contribution
        ]),
        totalCamps: 3,
      }),
    );
    const a = out.amber.find((x) => x.id === "fence-damaged");
    expect(a).toBeDefined();
    expect(a!.severity).toBe("amber");
    expect(a!.count).toBe(2);
    expect(a!.message).toBe("2 camps with a damaged or open fence");
    expect(a!.href).toBe(`/${FARM}/admin/camps`);
    expect(a!.species).toBe("farm");
  });

  it("single damaged fence → singular message", () => {
    const out = composeAlerts(
      base({
        campConditions: new Map([["c1", camp({ fence_status: "Damaged" })]]),
        totalCamps: 1,
      }),
    );
    expect(
      out.amber.find((x) => x.id === "fence-damaged")?.message,
    ).toBe("1 camp with a damaged or open fence");
  });

  it("all-Intact fences → no fence alert", () => {
    const out = composeAlerts(
      base({
        campConditions: new Map([["c1", camp()], ["c2", camp()]]),
        totalCamps: 2,
      }),
    );
    expect(out.amber.find((x) => x.id === "fence-damaged")).toBeUndefined();
  });
});

describe("composeAlerts — withdrawal source", () => {
  it("withdrawal animals → red in-withdrawal, pluralised", () => {
    const out = composeAlerts(
      base({
        withdrawalAnimals: [
          {
            animalId: "a1",
            name: null,
            campId: "c1",
            treatmentType: "antibiotic",
            treatedAt: NOW,
            withdrawalDays: 10,
            withdrawalEndsAt: NOW,
            daysRemaining: 5,
          },
        ],
      }),
    );
    const a = out.red.find((x) => x.id === "in-withdrawal");
    expect(a).toBeDefined();
    expect(a!.count).toBe(1);
    expect(a!.message).toBe("1 animal in withdrawal period");
    expect(a!.href).toBe(`/${FARM}/admin/animals`);
  });
});

describe("composeAlerts — rotation source", () => {
  it("overstayed → red, overdue_rest → amber", () => {
    const out = composeAlerts(
      base({
        rotationPayload: {
          camps: [
            { status: "overstayed" },
            { status: "overdue_rest" },
            { status: "grazing" },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }),
    );
    expect(out.red.find((x) => x.id === "rotation-overstayed")?.count).toBe(1);
    expect(out.amber.find((x) => x.id === "rotation-overdue-rest")?.count).toBe(
      1,
    );
  });
});

describe("composeAlerts — veld source", () => {
  it("critical → red, declining + overdue → amber", () => {
    const out = composeAlerts(
      base({
        veldSummary: {
          averageScore: null,
          campsAssessed: 3,
          campsTotal: 3,
          critical: [{ campId: "c1" }],
          declining: [{ campId: "c2" }],
          overdue: [{ campId: "c3" }],
          byCamp: [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }),
    );
    expect(out.red.find((x) => x.id === "veld-critical")?.count).toBe(1);
    expect(out.amber.find((x) => x.id === "veld-declining")?.count).toBe(1);
    expect(
      out.amber.find((x) => x.id === "veld-overdue-assessment")?.count,
    ).toBe(1);
  });
});

describe("composeAlerts — feed-on-offer source", () => {
  it("critical → red; low + stale → amber", () => {
    const out = composeAlerts(
      base({
        feedOnOfferPayload: {
          summary: {
            campsCritical: 2,
            campsLow: 1,
            campsStaleReading: 1,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }),
    );
    expect(
      out.red.find((x) => x.id === "feed-on-offer-critical")?.count,
    ).toBe(2);
    expect(out.amber.find((x) => x.id === "feed-on-offer-low")?.count).toBe(1);
    expect(
      out.amber.find((x) => x.id === "feed-on-offer-stale-reading")?.count,
    ).toBe(1);
  });
});

describe("composeAlerts — drought source", () => {
  it("SPI-3 <= -1.5 → red drought-severe", () => {
    const out = composeAlerts(
      base({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        droughtPayload: { spi3: { value: -1.8, severity: "severe" } } as any,
      }),
    );
    const a = out.red.find((x) => x.id === "drought-severe");
    expect(a).toBeDefined();
    expect(a!.message).toContain("-1.80");
  });

  it("SPI-3 <= -1.0 → amber drought-moderate", () => {
    const out = composeAlerts(
      base({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        droughtPayload: { spi3: { value: -1.2, severity: "moderate" } } as any,
      }),
    );
    expect(out.amber.find((x) => x.id === "drought-moderate")).toBeDefined();
  });
});

describe("composeAlerts — species-alert passthrough", () => {
  it("splits species alerts by severity", () => {
    const out = composeAlerts(
      base({
        speciesAlerts: [
          {
            id: "calving-due",
            severity: "red",
            icon: "Baby",
            message: "2 cows calving soon",
            count: 2,
            href: `/${FARM}/admin/animals`,
            species: "cattle",
          },
          {
            id: "poor-doer",
            severity: "amber",
            icon: "TrendingDown",
            message: "1 poor doer",
            count: 1,
            href: `/${FARM}/admin/performance`,
            species: "cattle",
          },
        ],
      }),
    );
    expect(ids(out.red)).toContain("calving-due");
    expect(ids(out.amber)).toContain("poor-doer");
    expect(out.totalCount).toBe(2);
  });
});
