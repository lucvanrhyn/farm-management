/**
 * __tests__/server/export-csv-it3-recon.test.ts
 *
 * Golden reconciliation test for the SARS / ITR12 IT3 CSV export (bug it3-M1).
 *
 * Root cause: `it3SnapshotToCSV` (lib/server/export-csv.ts) emitted only the
 * income / expense / summary / inventory sections but OMITTED the
 * stock-movement and foreign blocks that the PDF (`buildIt3Pdf`) renders from
 * the SAME payload. Because `netFarmingIncome` INCLUDES the stock-movement
 * delta (First Schedule para 5(1)):
 *
 *     netFarmingIncome = (totalIncome − totalExpenses) + stockMovement.deltaZar
 *
 * a reader of the CSV could not reconcile the reported net to its own section
 * figures, and the CSV disagreed with the PDF for the same farm/year.
 *
 * These tests lock the fix: the CSV must (a) include the stock-movement +
 * foreign sections, (b) reconcile EXACTLY to the reported net, and (c) agree
 * with the PDF total for the same input. SARS output → exact numeric equality,
 * no rounding drift.
 */

import { describe, it, expect } from "vitest";
import { it3SnapshotToCSV } from "@/lib/server/export-csv";
import { buildIt3Pdf } from "@/lib/server/sars-it3-pdf";
import { formatZar } from "@/lib/calculators/sars-it3";
import type { It3SnapshotPayload } from "@/lib/server/sars-it3";

// ── Realistic fixture ──────────────────────────────────────────────────────
// Mirrors the shape produced by getIt3Payload: domestic income/expense, a
// positive stock movement (closing > opening) that rolls into net, and a
// foreign block reported in parallel (NOT inside net). Figures are chosen so
// the para-5(1) identity holds exactly:
//   net = (60000 − 18000) + (52000 − 40000) = 42000 + 12000 = 54000
const OPENING_TOTAL = 40_000;
const CLOSING_TOTAL = 52_000;
const STOCK_DELTA = CLOSING_TOTAL - OPENING_TOTAL; // 12000
const TOTAL_INCOME = 60_000;
const TOTAL_EXPENSES = 18_000;
const NET = TOTAL_INCOME - TOTAL_EXPENSES + STOCK_DELTA; // 54000

function makePayload(
  overrides: Partial<It3SnapshotPayload> = {},
): It3SnapshotPayload {
  return {
    taxYear: 2026,
    periodStart: "2025-03-01",
    periodEnd: "2026-02-28",
    farm: {
      farmName: "Cross-Border Boerdery",
      ownerName: "Test Owner",
      ownerIdNumber: "7001015009088",
      taxReferenceNumber: "1234567890",
      physicalAddress: "1 Border Road, Ficksburg",
      postalAddress: "",
      contactPhone: "0821234567",
      contactEmail: "test@farm.co.za",
      propertyRegNumber: "SG21-123",
      farmRegion: "Free State",
    },
    schedules: {
      income: [
        {
          line: "Sales of livestock",
          code: "",
          amount: 60_000,
          sourceCategories: ["Animal Sales"],
          count: 4,
        },
      ],
      expense: [
        {
          line: "Feed and supplements",
          code: "",
          amount: 18_000,
          sourceCategories: ["Feed/Supplements"],
          count: 3,
        },
      ],
      totalIncome: TOTAL_INCOME,
      totalExpenses: TOTAL_EXPENSES,
      netFarmingIncome: NET,
      netFarmingIncomeBeforeStockMovement: TOTAL_INCOME - TOTAL_EXPENSES,
      openingStockValueZar: OPENING_TOTAL,
      closingStockValueZar: CLOSING_TOTAL,
      stockMovementZar: STOCK_DELTA,
      transactionCount: 7,
      farmingActivityCode: "0104",
      foreignFarmingIncome: {
        income: [
          {
            line: "Sales of livestock",
            code: "",
            amount: 5_000,
            sourceCategories: ["Animal Sales"],
            count: 1,
          },
        ],
        expense: [
          {
            line: "Veterinary services and medicine",
            code: "",
            amount: 800,
            sourceCategories: ["Medication/Vet"],
            count: 1,
          },
        ],
        totalIncome: 5_000,
        totalExpenses: 800,
        net: 4_200,
        activityCode: "0192",
      },
    },
    inventory: {
      activeAtPeriodEnd: 130,
      byCategory: [
        { category: "Cow", count: 100 },
        { category: "Bull", count: 30 },
      ],
    },
    stockMovement: {
      opening: {
        asOfDate: "2025-03-01",
        totalZar: OPENING_TOTAL,
        electionApplied: false,
        lines: [
          {
            species: "cattle",
            ageCategory: "Cow",
            count: 80,
            standardValueZar: 500,
            effectiveValueZar: 500,
            subtotalZar: OPENING_TOTAL,
          },
        ],
      },
      closing: {
        asOfDate: "2026-02-28",
        totalZar: CLOSING_TOTAL,
        electionApplied: false,
        lines: [
          {
            species: "cattle",
            ageCategory: "Cow",
            count: 104,
            standardValueZar: 500,
            effectiveValueZar: 500,
            subtotalZar: CLOSING_TOTAL,
          },
        ],
      },
      deltaZar: STOCK_DELTA,
      unmapped: [],
      source: "GN R105 (1965) as amended; IT35 (2023-10-13)",
    },
    meta: {
      generatedAtIso: "2026-04-30T10:00:00.000Z",
      generatedBy: "test-user",
      sourceTransactionCount: 7,
      categoryMapVersion: "2026-04-14",
      mappedCategories: [],
    },
    ...overrides,
  };
}

/** Parse the numeric value out of a `section,key,amount` CSV row. */
function findRowAmount(csv: string, prefix: string): number | null {
  const line = csv.split("\n").find((l) => l.startsWith(prefix));
  if (!line) return null;
  const last = line.split(",").pop();
  return last ? Number(last) : null;
}

function pdfToText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return str;
}

describe("it3SnapshotToCSV — it3-M1 stock-movement + foreign sections", () => {
  it("includes a stock-movement section with opening, closing and delta", () => {
    const csv = it3SnapshotToCSV(makePayload());

    expect(csv).toContain("stock_movement");
    // Opening + closing totals exposed as machine-readable rows.
    expect(findRowAmount(csv, "stock_movement,opening_stock_zar")).toBe(
      OPENING_TOTAL,
    );
    expect(findRowAmount(csv, "stock_movement,closing_stock_zar")).toBe(
      CLOSING_TOTAL,
    );
    expect(findRowAmount(csv, "stock_movement,stock_movement_zar")).toBe(
      STOCK_DELTA,
    );
  });

  it("includes a foreign section with the 0192/0193 totals", () => {
    const csv = it3SnapshotToCSV(makePayload());

    expect(csv).toContain("foreign");
    expect(findRowAmount(csv, "foreign,total_income_zar")).toBe(5_000);
    expect(findRowAmount(csv, "foreign,total_expenses_zar")).toBe(800);
    expect(findRowAmount(csv, "foreign,net_foreign_income_zar")).toBe(4_200);
    // SARS source code must be carried so the accountant can file it.
    expect(csv).toContain("0192");
  });

  it("reconciles EXACTLY: (income − expenses) + stock delta === net", () => {
    const csv = it3SnapshotToCSV(makePayload());

    const totalIncome = findRowAmount(csv, "summary,total_income_zar");
    const totalExpenses = findRowAmount(csv, "summary,total_expenses_zar");
    const stockDelta = findRowAmount(csv, "stock_movement,stock_movement_zar");
    const net = findRowAmount(csv, "summary,net_farming_income_zar");

    expect(totalIncome).not.toBeNull();
    expect(totalExpenses).not.toBeNull();
    expect(stockDelta).not.toBeNull();
    expect(net).not.toBeNull();

    // Exact equality — SARS output, no rounding drift.
    expect((totalIncome as number) - (totalExpenses as number) + (stockDelta as number)).toBe(
      net as number,
    );
    expect(net).toBe(NET);
  });

  it("CSV net total === PDF net total for the same farm/year", () => {
    const payload = makePayload();
    const csv = it3SnapshotToCSV(payload);
    const csvNet = findRowAmount(csv, "summary,net_farming_income_zar");

    const pdf = buildIt3Pdf({
      taxYear: payload.taxYear,
      issuedAt: new Date("2026-04-30T10:00:00.000Z"),
      payload: JSON.stringify(payload),
      generatedBy: "test-user",
      pdfHash: null,
      voidedAt: null,
      voidReason: null,
    });
    const pdfText = pdfToText(pdf);

    // The PDF renders the net via formatZar — the rendered string must be
    // present, and the CSV's numeric net must equal the same payload value.
    expect(csvNet).toBe(payload.schedules.netFarmingIncome);
    expect(pdfText).toContain(formatZar(payload.schedules.netFarmingIncome));
    expect(csvNet).toBe(NET);
  });

  it("omits stock-movement and foreign sections for a legacy payload", () => {
    // Older snapshots have neither block — the CSV must still render and just
    // omit them (no crash, no empty/garbage rows).
    const legacy = makePayload({ stockMovement: undefined });
    legacy.schedules = {
      ...legacy.schedules,
      foreignFarmingIncome: null,
      openingStockValueZar: undefined,
      closingStockValueZar: undefined,
      stockMovementZar: undefined,
      netFarmingIncomeBeforeStockMovement: undefined,
      netFarmingIncome: TOTAL_INCOME - TOTAL_EXPENSES,
    };

    const csv = it3SnapshotToCSV(legacy);
    expect(csv).not.toContain("stock_movement");
    expect(csv).not.toContain("foreign");
    // Legacy reconciliation: no stock term, so income − expenses === net.
    expect(findRowAmount(csv, "summary,net_farming_income_zar")).toBe(
      TOTAL_INCOME - TOTAL_EXPENSES,
    );
  });
});
