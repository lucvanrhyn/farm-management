// @vitest-environment jsdom
/**
 * __tests__/admin/dashboard-low-grazing-alert-spacing.test.tsx
 *
 * Issue #369 — the dashboard low-grazing alert rendered a glued-together
 * "1 campwith <7 days grazing remaining" label in production.
 *
 * Root cause: the JSX text node `" with …"` is adjacent to a `{ternary}`
 * expression. A build-time JSX/SWC whitespace strip can drop the leading
 * space of a text node that follows an `{expression}`, so the literal space
 * in the source disappears in the production bundle. (Project memory:
 * `feedback-*` notes on the JSX whitespace-stripping class of bug.)
 *
 * The robust fix is an explicit `{" "}` JSX expression rather than a literal
 * space in the text node — `{" "}` is a real expression child that the
 * transform cannot collapse.
 *
 * This file locks the regression on two layers:
 *  1. Render layer — the rendered alert paragraph's textContent must read
 *     "camp with" / "camps with" with the space (the acceptance criterion).
 *  2. Source layer — the JSX must pin the spaces with `{" "}` and must NOT
 *     fall back to a bare literal space between the ternary and `with`.
 *     A literal space renders identically in jsdom, so only the source-layer
 *     assertion actually fails if someone reverts the `{" "}` fix; it is the
 *     genuine guard against the production-only strip.
 *
 * Mirrors the render approach in __tests__/admin/dashboard-page-mode.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

// ── Hoisted mocks (memory rule: feedback-vi-hoisted-shared-mocks.md) ─────────

const mocks = vi.hoisted(() => ({
  getCachedDashboardOverview: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/server/cached", () => ({
  getCachedDashboardOverview: mocks.getCachedDashboardOverview,
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

// Suspense-friendly stubs for heavy children — not exercised by this test.
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

function overviewWith(lowGrazingCount: number) {
  return {
    totalAnimals: 0,
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
    lowGrazingCount,
    deathsToday: 0,
    birthsToday: 0,
    withdrawalCount: 0,
    mtdTransactions: [],
    dataHealth: { overall: 0, grade: "D" as const, breakdown: {} },
    dashboardAlerts: { red: [], amber: [], totalCount: 0 },
  };
}

async function renderDashboard(lowGrazingCount: number) {
  mocks.getCachedDashboardOverview.mockResolvedValue(
    overviewWith(lowGrazingCount),
  );
  const { default: DashboardContent } = await import(
    "@/components/admin/DashboardContent"
  );
  const element = await DashboardContent({
    farmSlug: "trio-b",
    // prisma unused inside DashboardContent — empty object is fine here
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: {} as any,
    tier: "advanced",
    mode: "cattle",
  });
  return render(element as React.ReactElement);
}

// ── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { role: "OWNER" } });
});

afterEach(() => cleanup());

describe("DashboardContent — low-grazing alert spacing (#369)", () => {
  it("renders '1 camp with <7 days grazing remaining' with a space before 'with'", async () => {
    const { container } = await renderDashboard(1);

    const alert = container.querySelector("a[href*='/admin/performance']");
    expect(alert).not.toBeNull();

    // textContent normalizes the rendered DOM — the word boundary must exist.
    const text = alert!.textContent ?? "";
    expect(text).toContain("camp with");
    expect(text).not.toContain("campwith");
    expect(text).toContain("<7 days grazing remaining");
    // Full singular phrase, spaces intact end-to-end.
    expect(text).toContain("1 camp with <7 days grazing remaining");
  });

  it("renders the plural 'camps with' variant with a space before 'with'", async () => {
    const { container } = await renderDashboard(3);

    const alert = container.querySelector("a[href*='/admin/performance']");
    expect(alert).not.toBeNull();

    const text = alert!.textContent ?? "";
    expect(text).toContain("camps with");
    expect(text).not.toContain("campswith");
    expect(text).toContain("3 camps with <7 days grazing remaining");
  });
});

describe("DashboardContent source — JSX spaces are pinned, not literal (#369)", () => {
  /**
   * The production-only SWC whitespace strip cannot be reproduced in jsdom,
   * so this source-level assertion is what genuinely locks the regression:
   * the space between the `camp`/`camps` ternary and the word `with` MUST be
   * an explicit `{" "}` JSX expression. A bare literal space renders fine in
   * tests but is the exact construct that broke in production.
   */
  it("uses an explicit {\" \"} between the camp/camps ternary and 'with'", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const src = await readFile(
      join(
        __dirname,
        "..",
        "..",
        "components",
        "admin",
        "DashboardContent.tsx",
      ),
      "utf-8",
    );

    // The ternary, then an explicit {" "} expression, then the word `with`.
    // Allows any whitespace (incl. newlines) between the JSX tokens.
    expect(src).toMatch(
      /\?\s*"camp"\s*:\s*"camps"\s*\}\s*\{"\s"\}\s*with\b/,
    );

    // Negative guard: the ternary must NOT be followed directly by a bare
    // ` with` text node — that literal-space construct is the latent defect.
    expect(src).not.toMatch(/:\s*"camps"\s*\}\s+with\b/);
  });
});
