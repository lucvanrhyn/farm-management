// @vitest-environment jsdom
/**
 * ADR-0005 step 5-6 — the dashboard header badge is a *partial pass* of the
 * single composition core, not a bespoke formula.
 *
 * Before this wave, DashboardClient computed its "open alerts" number with
 * `grazing_quality === "Poor" || fence_status !== "Intact"` over the offline
 * `liveConditions` prop — a formula the canonical engine never ran. This test
 * pins the new contract:
 *
 *   1. The header count equals
 *      `composeAlerts({ campConditions: <adapted from liveConditions>,
 *       totalCamps: camps.length, thresholds, farmSlug, now }).totalCount`.
 *   2. That partial-pass count is <= the full server pass for the SAME
 *      conditions (monotonicity / prefix guarantee — the header can only
 *      ever under-report toward the canonical number, never contradict it).
 *
 * The dynamic children (StatsStrip / SidePanel / FarmMap) are replaced with
 * lightweight probes so the assertion targets the header number, not leaflet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { composeAlerts } from "@/lib/server/alerts/compose";
import type { AlertThresholds } from "@/lib/server/dashboard-alerts";
import type { LiveCampStatus } from "@/lib/server/camp-status";
import type { Camp } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useParams: () => ({ farmSlug: "demo-farm" }),
  usePathname: () => "/demo-farm/dashboard",
}));

vi.mock("@/lib/farm-mode", () => ({
  useFarmModeSafe: () => ({ mode: "cattle", isMultiMode: false }),
}));

// Render-once helper: useClientTime gates wall-clock strings behind mount.
vi.mock("@/lib/hooks/use-client-time", () => ({
  useClientTime: (_fn: unknown, fallback: unknown) => fallback,
}));

// Dynamic children → probes. DashboardStatsStrip exposes alertLabel so we
// can read the exact header number the component computed.
vi.mock("next/dynamic", () => ({
  default: (loader: unknown, opts?: { loading?: () => React.ReactNode }) => {
    void loader;
    void opts;
    return function DynamicProbe(props: Record<string, unknown>) {
      if ("alertLabel" in props) {
        return (
          <div data-testid="alert-label">{String(props.alertLabel)}</div>
        );
      }
      return null;
    };
  },
}));

vi.mock("../SchematicMap", () => ({ default: () => null }));
vi.mock("../WeatherWidget", () => ({ default: () => null }));
vi.mock("@/components/logger/SignOutButton", () => ({
  SignOutButton: () => null,
}));

import DashboardClient from "../DashboardClient";

const THRESHOLDS: AlertThresholds = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  staleCampInspectionHours: 48,
};

const FARM = "demo-farm";

function makeCamps(ids: string[]): Camp[] {
  return ids.map((id) => ({
    camp_id: id,
    camp_name: id,
    size_hectares: 10,
    water_source: "Borehole",
    geojson: null,
    notes: null,
    animal_count: 0,
  })) as unknown as Camp[];
}

// The header's offline source is the `/api/camps/status` payload, keyed by
// camp_id, each value a LiveCampStatus-shaped record. The adapter under test
// turns that Record into the Map<string, LiveCampStatus> composeAlerts wants.
function adapt(
  live: Record<string, LiveCampStatus>,
): Map<string, LiveCampStatus> {
  return new Map(Object.entries(live));
}

describe("DashboardClient header — partial composeAlerts pass", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("header count == composeAlerts(partial bag).totalCount, and <= full pass", async () => {
    // Two poor-grazing camps + one damaged-fence camp + one clean camp.
    // The OLD bespoke formula counts matching CAMPS → 3 (c1, c2, c3).
    // composeAlerts counts ALERT TYPES → 2 (one poor-grazing alert with
    // count=2, one fence-damaged alert with count=1). The fixture is chosen
    // so the two numbers diverge — this is what makes the test fail while the
    // bespoke formula is still in place.
    const live: Record<string, LiveCampStatus> = {
      c1: {
        grazing_quality: "Poor",
        water_status: "Full",
        fence_status: "Intact",
        last_inspected_at: new Date().toISOString(),
        last_inspected_by: "t",
      },
      c2: {
        grazing_quality: "Poor",
        water_status: "Full",
        fence_status: "Intact",
        last_inspected_at: new Date().toISOString(),
        last_inspected_by: "t",
      },
      c3: {
        grazing_quality: "Good",
        water_status: "Full",
        fence_status: "Damaged",
        last_inspected_at: new Date().toISOString(),
        last_inspected_by: "t",
      },
      c4: {
        grazing_quality: "Good",
        water_status: "Full",
        fence_status: "Intact",
        last_inspected_at: new Date().toISOString(),
        last_inspected_by: "t",
      },
    };
    const camps = makeCamps(["c1", "c2", "c3", "c4"]);

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => live,
    })) as unknown as typeof fetch;

    render(
      <DashboardClient
        farmSlug={FARM}
        totalAnimals={0}
        campAnimalCounts={{}}
        camps={camps}
      />,
    );

    const label = await screen.findByTestId("alert-label");
    await waitFor(() => {
      expect(label.textContent).not.toBe("—");
    });

    const now = new Date();
    const partial = composeAlerts({
      campConditions: adapt(live),
      totalCamps: camps.length,
      thresholds: THRESHOLDS,
      farmSlug: FARM,
      now,
    });

    // Header renders exactly the partial-pass total.
    expect(label.textContent).toBe(String(partial.totalCount));
    // poor-grazing (red) + fence-damaged (amber) = 2.
    expect(partial.totalCount).toBe(2);

    // Prefix guarantee: the same conditions in a FULL pass (extra server-only
    // sources present) can only add alerts, never remove the header's.
    const full = composeAlerts({
      campConditions: adapt(live),
      totalCamps: camps.length,
      withdrawalAnimals: [
        {
          animalId: "a1",
          species: "cattle",
          name: null,
          campId: "c1",
          treatmentType: "ab",
          treatedAt: now,
          withdrawalDays: 5,
          withdrawalEndsAt: now,
          daysRemaining: 3,
        },
      ],
      thresholds: THRESHOLDS,
      farmSlug: FARM,
      now,
    });
    const partialIds = new Set(
      [...partial.red, ...partial.amber].map((a) => a.id),
    );
    const fullIds = new Set([...full.red, ...full.amber].map((a) => a.id));
    for (const id of partialIds) expect(fullIds.has(id)).toBe(true);
    expect(partial.totalCount).toBeLessThanOrEqual(full.totalCount);
  });
});
