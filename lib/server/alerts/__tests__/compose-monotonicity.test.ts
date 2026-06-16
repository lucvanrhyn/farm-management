/**
 * @vitest-environment node
 *
 * ADR-0005 — the monotonicity / prefix invariant, locked structurally.
 *
 * Example tests (compose.test.ts) pin individual cases; they do not prevent
 * a future PR from re-introducing a header-specific shortcut or a
 * non-monotone source. This test asserts the structural guarantee directly:
 *
 *   for ANY input bag, for EVERY subset of its present sources,
 *     composeAlerts(subset).ids        ⊆ composeAlerts(superset).ids
 *     composeAlerts(subset).totalCount  <= composeAlerts(superset).totalCount
 *
 * This is what makes the offline header a provable *prefix* of the canonical
 * `/admin/alerts` pass: adding a source can only ever add alerts, never
 * remove or rewrite one. It plays the same role for ADR-0005 that
 * `__tests__/architecture/sync-truth-no-direct-callers.test.ts` plays for
 * ADR-0002 — it makes the divergence *class* impossible, not just the one
 * instance we found. If a future change makes any source subtractive (e.g.
 * a source that suppresses another's alert), the power-set sweep below
 * fails.
 */
import { describe, it, expect } from "vitest";
import { composeAlerts, type AlertInputs } from "@/lib/server/alerts/compose";
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

function staleCamp(): LiveCampStatus {
  return {
    grazing_quality: "Poor",
    water_status: "Empty",
    fence_status: "Damaged",
    last_inspected_at: new Date(
      NOW.getTime() - 96 * 60 * 60 * 1000,
    ).toISOString(),
    last_inspected_by: "t",
  };
}

/**
 * Every *optional source* the engine knows about, each populated with a
 * value that DOES produce at least one alert. The power-set of these keys is
 * swept; required config is always present.
 */
const SOURCES: Record<string, Partial<AlertInputs>> = {
  campConditions: {
    campConditions: new Map([
      ["c1", staleCamp()],
      ["c2", staleCamp()],
    ]),
    totalCamps: 4, // 2 conditioned of 4 → also drives stale-inspections
  },
  withdrawalAnimals: {
    withdrawalAnimals: [
      {
        animalId: "a1",
        species: "cattle",
        name: null,
        campId: "c1",
        treatmentType: "ab",
        treatedAt: NOW,
        withdrawalDays: 5,
        withdrawalEndsAt: NOW,
        daysRemaining: 3,
      },
    ],
  },
  rotationPayload: {
    rotationPayload: {
      camps: [{ status: "overstayed" }, { status: "overdue_rest" }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  },
  veldSummary: {
    veldSummary: {
      critical: [{ campId: "c1" }],
      declining: [{ campId: "c2" }],
      overdue: [{ campId: "c3" }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  },
  feedOnOfferPayload: {
    feedOnOfferPayload: {
      summary: { campsCritical: 1, campsLow: 1, campsStaleReading: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  },
  droughtPayload: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    droughtPayload: { spi3: { value: -1.8, severity: "severe" } } as any,
  },
  speciesAlerts: {
    speciesAlerts: [
      {
        id: "calving-due",
        severity: "red",
        icon: "Baby",
        message: "x",
        count: 1,
        href: `/${FARM}/admin/animals`,
        species: "cattle",
      },
    ],
  },
};

const KEYS = Object.keys(SOURCES);

function bagFor(keys: string[]): AlertInputs {
  let bag: AlertInputs = { thresholds: THRESHOLDS, farmSlug: FARM, now: NOW };
  for (const k of keys) bag = { ...bag, ...SOURCES[k] };
  return bag;
}

function idsOf(keys: string[]): Set<string> {
  const out = composeAlerts(bagFor(keys));
  return new Set([...out.red, ...out.amber].map((a) => a.id));
}

function totalOf(keys: string[]): number {
  return composeAlerts(bagFor(keys)).totalCount;
}

/** All subsets of `arr`. 2^7 = 128 bags — cheap, exhaustive. */
function powerSet<T>(arr: T[]): T[][] {
  return arr.reduce<T[][]>(
    (acc, x) => acc.concat(acc.map((s) => [...s, x])),
    [[]],
  );
}

describe("composeAlerts — monotonicity / prefix invariant (ADR-0005)", () => {
  const allSubsets = powerSet(KEYS);

  it("determinism: same bag → identical output", () => {
    expect(composeAlerts(bagFor(KEYS))).toEqual(composeAlerts(bagFor(KEYS)));
  });

  it("every subset is a prefix of every superset (ids ⊆, totalCount <=)", () => {
    const violations: string[] = [];
    for (const subset of allSubsets) {
      const subIds = idsOf(subset);
      const subTotal = totalOf(subset);
      // Compare against every strict superset (subset ∪ one or more keys).
      for (const superset of allSubsets) {
        const supSet = new Set(superset);
        const isSuperset = subset.every((k) => supSet.has(k));
        if (!isSuperset) continue;
        const supIds = idsOf(superset);
        for (const id of subIds) {
          if (!supIds.has(id)) {
            violations.push(
              `id "${id}" present for [${subset.join(",")}] but missing for superset [${superset.join(",")}]`,
            );
          }
        }
        if (subTotal > totalOf(superset)) {
          violations.push(
            `totalCount(${subTotal}) for [${subset.join(",")}] > totalCount(${totalOf(superset)}) for superset [${superset.join(",")}]`,
          );
        }
      }
    }
    expect(
      violations,
      [
        "ADR-0005 monotonicity broken — a source removed/rewrote another's alert:",
        ...violations.slice(0, 20),
        violations.length > 20 ? `…and ${violations.length - 20} more` : "",
        "",
        "Every optional source must be purely additive: composeAlerts(subset)",
        "must be a prefix of composeAlerts(superset). The offline header relies",
        "on this to be a provable subset of the canonical /admin/alerts pass.",
        "See docs/adr/0005-dashboard-alert-composition.md.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("empty bag → empty set (absent source contributes nothing)", () => {
    const out = composeAlerts(bagFor([]));
    expect(out.totalCount).toBe(0);
    expect(out.red).toEqual([]);
    expect(out.amber).toEqual([]);
  });
});
