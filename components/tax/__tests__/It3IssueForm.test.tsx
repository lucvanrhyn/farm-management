// @vitest-environment jsdom
/**
 * Issue #451 — IT3 preview disclosure for livestock stock-movement delta.
 *
 * The calculator (`lib/calculators/sars-it3.ts`) correctly includes
 *   net = (totalIncome - totalExpenses) + stockMovement.deltaZar
 * per First Schedule paragraph 5(1). Pre-fix UI only printed income + expense
 * + net, so a tenant with R0 of transactions but a non-zero standard-value
 * stock delta saw "Income R0 · Expenses R0 · Net R1438" with no disclosure of
 * the closing − opening stock term. The bug was UI-only.
 *
 * These tests pin two contracts:
 *   1. When `stockMovementZar` is present and non-zero, the preview surfaces
 *      a disclosure row showing the ZAR delta, the "net before stock movement"
 *      figure, and a SARS para 5(1) citation referencing GN R1814.
 *   2. When `stockMovementZar` is absent or zero, the preview is unchanged
 *      (no regression for tenants without stock-movement computation).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import type { It3SnapshotPayload } from "@/lib/server/sars-it3";
import It3IssueForm from "../It3IssueForm";

function makePayload(overrides: {
  totalIncome?: number;
  totalExpenses?: number;
  netFarmingIncome?: number;
  netFarmingIncomeBeforeStockMovement?: number;
  stockMovementZar?: number;
  openingStockValueZar?: number;
  closingStockValueZar?: number;
}): It3SnapshotPayload {
  return {
    taxYear: 2026,
    periodStart: "2025-03-01",
    periodEnd: "2026-02-28",
    farm: {
      farmName: "Test Farm",
      ownerName: "",
      ownerIdNumber: "",
      taxReferenceNumber: "",
      physicalAddress: "",
    } as It3SnapshotPayload["farm"],
    schedules: {
      income: [],
      expense: [],
      totalIncome: overrides.totalIncome ?? 0,
      totalExpenses: overrides.totalExpenses ?? 0,
      netFarmingIncome: overrides.netFarmingIncome ?? 0,
      netFarmingIncomeBeforeStockMovement:
        overrides.netFarmingIncomeBeforeStockMovement,
      stockMovementZar: overrides.stockMovementZar,
      openingStockValueZar: overrides.openingStockValueZar,
      closingStockValueZar: overrides.closingStockValueZar,
      transactionCount: 0,
      farmingActivityCode: "0104",
      foreignFarmingIncome: null,
    },
    inventory: {} as It3SnapshotPayload["inventory"],
    meta: {
      generatedAtIso: "2026-05-27T00:00:00.000Z",
      generatedBy: null,
      sourceTransactionCount: 0,
      categoryMapVersion: "2026-04-14",
      mappedCategories: [],
      farmingActivityCode: "0104",
    },
  };
}

function mockFetch(payload: It3SnapshotPayload) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  })) as unknown as typeof fetch;
}

describe("It3IssueForm preview — stock-movement disclosure (#451)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders stock-movement disclosure with SARS para 5(1) citation when stockMovementZar is non-zero", async () => {
    // Tenant with R0 transactions but a non-zero standard-value stock delta —
    // the issue #451 repro case ("R0 income · R0 expenses · net R1438").
    const payload = makePayload({
      totalIncome: 0,
      totalExpenses: 0,
      netFarmingIncome: 1438,
      netFarmingIncomeBeforeStockMovement: 0,
      stockMovementZar: 1438,
      openingStockValueZar: 2150,
      closingStockValueZar: 3588,
    });
    mockFetch(payload);

    render(<It3IssueForm farmSlug="test-farm" onIssued={vi.fn()} />);

    // Wait for the preview to render (after the loadPreview useEffect resolves).
    await waitFor(() => {
      expect(screen.getByText(/Total farming income/i)).toBeInTheDocument();
    });

    // The disclosure row must show "net before stock movement" alongside the
    // stock-movement delta in ZAR.
    expect(
      screen.getByText(/Net farming income before stock movement/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Stock movement \(closing − opening/i),
    ).toBeInTheDocument();

    // The R1438 stock delta must appear in the rendered output.
    const r1438Matches = screen.getAllByText(/R\s*1[\s,]*438/);
    expect(r1438Matches.length).toBeGreaterThan(0);

    // SARS-compliant citation: paragraph 5(1) of the First Schedule + the
    // gazetted standard values (GN R1814). The citation language must be
    // concise and not fabricate amounts.
    expect(screen.getByText(/paragraph 5\(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/GN\s*R1814/i)).toBeInTheDocument();
  });

  it("does not render extra rows when stockMovementZar is undefined", async () => {
    // Backward-compat path: tenants whose calculator was called without a
    // stockMovement option (or who have zero delta) must see the original
    // preview unchanged.
    const payload = makePayload({
      totalIncome: 100000,
      totalExpenses: 60000,
      netFarmingIncome: 40000,
      // No stockMovementZar / netFarmingIncomeBeforeStockMovement.
    });
    mockFetch(payload);

    render(<It3IssueForm farmSlug="test-farm" onIssued={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Total farming income/i)).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/Net farming income before stock movement/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Stock movement/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/paragraph 5\(1\)/i)).not.toBeInTheDocument();
  });

  it("does not render extra rows when stockMovementZar is zero", async () => {
    // Edge case: the calculator emitted the field but the delta itself is
    // zero (opening == closing). No regression / no clutter.
    const payload = makePayload({
      totalIncome: 100000,
      totalExpenses: 60000,
      netFarmingIncome: 40000,
      netFarmingIncomeBeforeStockMovement: 40000,
      stockMovementZar: 0,
      openingStockValueZar: 2150,
      closingStockValueZar: 2150,
    });
    mockFetch(payload);

    render(<It3IssueForm farmSlug="test-farm" onIssued={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Total farming income/i)).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/Net farming income before stock movement/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/paragraph 5\(1\)/i)).not.toBeInTheDocument();
  });
});
