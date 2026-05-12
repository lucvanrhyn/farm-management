// @vitest-environment jsdom
/**
 * __tests__/admin/dashboard-page-mode.test.tsx
 *
 * Issue #225 — admin dashboard home (/[farmSlug]/admin) must read the
 * persisted FarmMode cookie and thread `mode` into every downstream
 * cached helper.
 *
 * Mirrors __tests__/admin/species-filter-pages.test.tsx — we mock the
 * cached helpers, render the page server-component fn, and assert mode
 * reached the helper boundary AND the rendered hero count matches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ── Hoisted mocks (memory rule: feedback-vi-hoisted-shared-mocks.md) ─────────

const mocks = vi.hoisted(() => ({
  getFarmMode: vi.fn(),
  getPrismaForFarm: vi.fn(),
  getFarmCreds: vi.fn(),
  getCachedFarmSettings: vi.fn(),
  getCachedDashboardOverview: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/server/get-farm-mode", () => ({
  getFarmMode: mocks.getFarmMode,
}));

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: mocks.getPrismaForFarm,
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock("@/lib/meta-db", () => ({
  getFarmCreds: mocks.getFarmCreds,
}));

vi.mock("@/lib/server/cached", () => ({
  getCachedFarmSettings: mocks.getCachedFarmSettings,
  getCachedDashboardOverview: mocks.getCachedDashboardOverview,
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

// Suspense-friendly stubs for heavy children.
vi.mock("@/components/dashboard/WeatherWidget", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/NeedsAttentionPanel", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/DataHealthCard", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/DangerZone", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/AnimatedNumber", () => ({
  default: ({ value }: { value: number }) => <>{value}</>,
}));

// ── Overview fixture builder ─────────────────────────────────────────────────

function overviewWith(totalAnimals: number) {
  return {
    totalAnimals,
    totalCamps: 0,
    reproStats: {
      pregnancyRate: null,
      calvingRate: null,
      avgCalvingIntervalDays: null,
      upcomingCalvings: [],
      inHeat7d: 0,
      inseminations30d: 0,
      calvingsDue30d: 0,
      scanCounts: { pregnant: 0, empty: 0, uncertain: 0 },
      conceptionRate: null,
      pregnancyRateByCycle: [],
      daysOpen: [],
      avgDaysOpen: null,
      weaningRate: null,
    },
    liveConditions: {},
    healthIssuesThisWeek: 0,
    inspectedToday: 0,
    recentHealth: [],
    lowGrazingCount: 0,
    deathsToday: 0,
    birthsToday: 0,
    withdrawalCount: 0,
    mtdTransactions: [],
    dataHealth: { overall: 0, grade: "D" as const, breakdown: {} },
    dashboardAlerts: { red: [], amber: [], totalCount: 0 },
  };
}

// ── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFarmCreds.mockResolvedValue({ tier: "advanced" });
  mocks.getPrismaForFarm.mockResolvedValue({});
  mocks.getCachedFarmSettings.mockResolvedValue({
    adgPoorDoerThreshold: 0.7,
    calvingAlertDays: 14,
    daysOpenLimit: 365,
    campGrazingWarningDays: 7,
    alertThresholdHours: 48,
    farmName: "F",
    breed: "B",
    latitude: null,
    longitude: null,
  });
  mocks.getSession.mockResolvedValue({ user: { role: "OWNER" } });
});

afterEach(() => cleanup());

describe("/[farmSlug]/admin/page.tsx — source-level FarmMode wiring (#225)", () => {
  // Page.tsx renders DashboardContent inside a Suspense boundary, which
  // jsdom can't unwrap reliably without a full React Server Components
  // runtime. A source-level grep is the established pattern here (see
  // __tests__/admin/reproduction-page-denorm.test.ts).
  it("imports getFarmMode and forwards mode={mode} to <DashboardContent>", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const src = await readFile(
      join(
        __dirname,
        "..",
        "..",
        "app",
        "[farmSlug]",
        "admin",
        "page.tsx",
      ),
      "utf-8",
    );
    expect(src).toMatch(/from\s+["']@\/lib\/server\/get-farm-mode["']/);
    expect(src).toMatch(/getFarmMode\(\s*farmSlug\s*\)/);
    // The mode is passed as a prop to DashboardContent.
    expect(src).toMatch(/<DashboardContent[^>]*mode=\{mode\}/);
  });
});

describe("DashboardContent — calls getCachedDashboardOverview with mode (#225)", () => {
  it("forwards mode='cattle' to getCachedDashboardOverview and renders the cattle count", async () => {
    mocks.getCachedDashboardOverview.mockResolvedValue(overviewWith(10));

    const { default: DashboardContent } = await import(
      "@/components/admin/DashboardContent"
    );

    const element = await DashboardContent({
      farmSlug: "trio-b",
      // prisma unused inside DashboardContent — empty object is fine for this test
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: {} as any,
      tier: "advanced",
      mode: "cattle",
    });
    render(element as React.ReactElement);

    expect(mocks.getCachedDashboardOverview).toHaveBeenCalledWith(
      "trio-b",
      "cattle",
    );
    expect(screen.getByText("Total Animals")).toBeTruthy();
    expect(screen.getAllByText("10").length).toBeGreaterThan(0);
  });

  it("forwards mode='sheep' and renders the sheep count", async () => {
    mocks.getCachedDashboardOverview.mockResolvedValue(overviewWith(5));

    const { default: DashboardContent } = await import(
      "@/components/admin/DashboardContent"
    );

    const element = await DashboardContent({
      farmSlug: "trio-b",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: {} as any,
      tier: "advanced",
      mode: "sheep",
    });
    render(element as React.ReactElement);

    expect(mocks.getCachedDashboardOverview).toHaveBeenCalledWith(
      "trio-b",
      "sheep",
    );
    expect(screen.getByText("Total Animals")).toBeTruthy();
    expect(screen.getAllByText("5").length).toBeGreaterThan(0);
  });
});
