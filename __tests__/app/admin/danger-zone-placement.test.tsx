/**
 * @vitest-environment jsdom
 *
 * __tests__/app/admin/danger-zone-placement.test.tsx
 *
 * Wave C / U4 — Codex audit P2 polish (2026-05-10).
 *
 * The destructive "Clear All …" buttons used to live in the admin page
 * headers, next to the title — visually prominent for a one-tap-destroys-
 * everything action. Codex flagged this. The fix: move each ClearSectionButton
 * into a footer-level "Danger zone" section at the BOTTOM of the page.
 *
 * Tests use a marker-stub for ClearSectionButton (its internal two-step
 * confirm UX is out of scope; only its placement matters) and assert:
 *   1. A `data-testid="danger-zone"` wrapper exists.
 *   2. The ClearSectionButton marker renders INSIDE that wrapper.
 *   3. The marker does NOT render inside the page's h1 header row.
 *   4. Danger zone appears AFTER the main content in DOM order.
 *
 * Three pages covered: animals, observations, finansies. Each test sets
 * up its own page-specific mocks because each page reaches into different
 * data sources.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// Shared marker for the destructive button — lets us probe its location.
vi.mock("@/components/admin/ClearSectionButton", () => ({
  default: ({ label }: { label: string }) => (
    <span data-testid="clear-section-button" data-label={label} />
  ),
}));

// Heavyweight client components on each page → noop stubs.
vi.mock("@/components/admin/AnimalsTable", () => ({ default: () => null }));
vi.mock("@/components/admin/RecordBirthButton", () => ({ default: () => null }));
vi.mock("@/components/admin/ExportButton", () => ({ default: () => null }));
vi.mock("@/components/admin/AnimalAnalyticsSection", () => ({ default: () => null }));
vi.mock("@/components/admin/UpgradePrompt", () => ({ default: () => null }));
vi.mock("@/components/admin/FinansiesClient", () => ({ default: () => null }));
vi.mock("@/components/admin/FinancialAnalyticsPanelLazy", () => ({ default: () => null }));
vi.mock("@/components/admin/FinancialChartsSection", () => ({ default: () => null }));
vi.mock("@/components/admin/FinancialKPISection", () => ({ default: () => null }));
vi.mock("@/components/admin/BudgetVsActualSection", () => ({ default: () => null }));
vi.mock("@/components/admin/CostOfGainSection", () => ({ default: () => null }));
vi.mock("@/components/admin/DateRangePicker", () => ({ default: () => null }));
vi.mock(
  "@/app/[farmSlug]/admin/observations/ObservationsPageClient",
  () => ({ default: () => null }),
);

// Server-only helpers.
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getFarmCredsMock = vi.fn();
const getAnimalsInWithdrawalMock = vi.fn();
const getServerSessionMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/lib/farm-prisma", () => ({ getPrismaForFarm: getPrismaForFarmMock }));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/meta-db", () => ({ getFarmCreds: getFarmCredsMock }));
vi.mock("@/lib/server/treatment-analytics", () => ({
  getAnimalsInWithdrawal: getAnimalsInWithdrawalMock,
}));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

// Active-species filter is a tiny helper; safe to use the real impl, but
// stubbing it avoids dragging extra imports.
vi.mock("@/lib/animals/active-species-filter", () => ({
  activeSpeciesWhere: () => ({}),
}));

interface PageHarnessResult {
  container: HTMLElement;
  h1: HTMLElement;
  dangerZone: HTMLElement | null;
  clearButton: HTMLElement | null;
}

function harness(container: HTMLElement): PageHarnessResult {
  const h1 = container.querySelector("h1");
  if (!h1) throw new Error("Page rendered without an h1 — test cannot proceed");
  return {
    container,
    h1: h1 as HTMLElement,
    dangerZone: container.querySelector('[data-testid="danger-zone"]'),
    clearButton: container.querySelector('[data-testid="clear-section-button"]'),
  };
}

function assertCanonicalPlacement(result: PageHarnessResult, expectedLabel: string) {
  // 1. Danger zone wrapper present.
  expect(result.dangerZone).not.toBeNull();
  // 2. ClearSectionButton rendered inside the danger zone.
  expect(result.clearButton).not.toBeNull();
  expect(result.clearButton!.getAttribute("data-label")).toBe(expectedLabel);
  expect(result.dangerZone!.contains(result.clearButton!)).toBe(true);
  // 3. The danger-zone wrapper must NOT also wrap the h1 — that would
  // mean the destructive button is co-located with the title (the bug we
  // are fixing). Combined with (2) this guarantees the only ancestor of
  // the clear button between the page root and itself is the danger zone.
  expect(result.dangerZone!.contains(result.h1)).toBe(false);
  // 4. Danger zone appears AFTER the h1 in DOM order.
  const ordering = result.h1.compareDocumentPosition(result.dangerZone!);
  // Node.DOCUMENT_POSITION_FOLLOWING === 4
  expect(ordering & 4).toBeTruthy();
}

beforeEach(() => {
  vi.clearAllMocks();
  getFarmModeMock.mockResolvedValue("cattle");
  getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
  getAnimalsInWithdrawalMock.mockResolvedValue([]);
  getServerSessionMock.mockResolvedValue({ user: { email: "luc@farmtrack.app" } });
  redirectMock.mockImplementation(() => {
    throw new Error("redirect-not-expected-in-this-test");
  });
  getPrismaForFarmMock.mockResolvedValue({
    animal: { findMany: vi.fn().mockResolvedValue([]) },
    camp: { findMany: vi.fn().mockResolvedValue([]) },
    mob: { findMany: vi.fn().mockResolvedValue([]) },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    transactionCategory: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  });
});

describe("Admin Animals page — Wave C / U4 danger-zone placement", () => {
  it("renders ClearSectionButton inside a footer-level danger-zone wrapper", async () => {
    const { default: Page } = await import(
      "@/app/[farmSlug]/admin/animals/page"
    );
    const element = await Page({
      params: Promise.resolve({ farmSlug: "trio-b" }),
      searchParams: Promise.resolve({}),
    } as unknown as Parameters<typeof Page>[0]);
    const { container } = render(element as React.ReactElement);
    assertCanonicalPlacement(harness(container), "Clear All Animals");
  });
});

describe("Admin Observations page — Wave C / U4 danger-zone placement", () => {
  it("renders ClearSectionButton inside a footer-level danger-zone wrapper", async () => {
    const { default: Page } = await import(
      "@/app/[farmSlug]/admin/observations/page"
    );
    const element = await Page({
      params: Promise.resolve({ farmSlug: "trio-b" }),
      searchParams: Promise.resolve({}),
    } as unknown as Parameters<typeof Page>[0]);
    const { container } = render(element as React.ReactElement);
    assertCanonicalPlacement(harness(container), "Clear All Observations");
  });
});

describe("Admin Finansies page — Wave C / U4 danger-zone placement", () => {
  it("renders ClearSectionButton inside a footer-level danger-zone wrapper", async () => {
    const { default: Page } = await import(
      "@/app/[farmSlug]/admin/finansies/page"
    );
    const element = await Page({
      params: Promise.resolve({ farmSlug: "trio-b" }),
      searchParams: Promise.resolve({}),
    } as unknown as Parameters<typeof Page>[0]);
    const { container } = render(element as React.ReactElement);
    assertCanonicalPlacement(harness(container), "Clear All Transactions");
  });
});
