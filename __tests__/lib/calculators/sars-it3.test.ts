import { describe, it, expect } from "vitest";
import {
  IT3_SCHEDULE_MAP,
  IT3_OTHER_INCOME_LINE,
  IT3_OTHER_EXPENSE_LINE,
  getSaTaxYearRange,
  isInTaxYear,
  getRecentTaxYears,
  mapTransactionToLine,
  computeIt3Schedules,
  formatZar,
  type TransactionLike,
} from "@/lib/calculators/sars-it3";

// ── getSaTaxYearRange ─────────────────────────────────────────────────────────

describe("getSaTaxYearRange", () => {
  it("returns 1 March → 28 Feb for a non-leap-ending year", () => {
    // SA tax year ending Feb 2026 is not a leap year
    expect(getSaTaxYearRange(2026)).toEqual({
      start: "2025-03-01",
      end: "2026-02-28",
    });
  });

  it("returns 29 Feb for a leap-ending year", () => {
    // 2024 is a leap year — Feb 2024 has 29 days
    expect(getSaTaxYearRange(2024)).toEqual({
      start: "2023-03-01",
      end: "2024-02-29",
    });
  });

  it("treats year-2000 (divisible by 400) as a leap year", () => {
    expect(getSaTaxYearRange(2000).end).toBe("2000-02-29");
  });

  it("treats year-2100 (divisible by 100 but not 400) as non-leap", () => {
    expect(getSaTaxYearRange(2100).end).toBe("2100-02-28");
  });
});

// ── isInTaxYear ───────────────────────────────────────────────────────────────

describe("isInTaxYear", () => {
  it("includes the 1 March start boundary", () => {
    expect(isInTaxYear("2025-03-01", 2026)).toBe(true);
  });

  it("includes the end-of-Feb boundary", () => {
    expect(isInTaxYear("2026-02-28", 2026)).toBe(true);
  });

  it("excludes 28 Feb of the start year (previous tax year)", () => {
    expect(isInTaxYear("2025-02-28", 2026)).toBe(false);
  });

  it("excludes 1 March of the end year (next tax year)", () => {
    expect(isInTaxYear("2026-03-01", 2026)).toBe(false);
  });

  it("includes a mid-year sale", () => {
    expect(isInTaxYear("2025-08-15", 2026)).toBe(true);
  });
});

// ── getRecentTaxYears ─────────────────────────────────────────────────────────

describe("getRecentTaxYears", () => {
  it("treats Jan/Feb as inside the still-open tax year ending that calendar year", () => {
    // 15 Jan 2026 → still in 2025-03-01..2026-02-28, so tax year ending 2026
    const years = getRecentTaxYears(new Date("2026-01-15T00:00:00Z"), 3);
    expect(years).toEqual([2026, 2025, 2024]);
  });

  it("treats March onwards as the next tax year (ending the following calendar year)", () => {
    // 14 Apr 2026 → in 2026-03-01..2027-02-28, so tax year ending 2027
    const years = getRecentTaxYears(new Date("2026-04-14T00:00:00Z"), 3);
    expect(years).toEqual([2027, 2026, 2025]);
  });

  it("defaults to 5 years", () => {
    expect(getRecentTaxYears(new Date("2026-04-14T00:00:00Z")).length).toBe(5);
  });
});

// ── mapTransactionToLine ──────────────────────────────────────────────────────

describe("mapTransactionToLine", () => {
  it("maps a default income category to its schedule line", () => {
    const mapped = mapTransactionToLine({
      type: "income",
      category: "Animal Sales",
      amount: 50000,
      date: "2025-08-01",
    });
    expect(mapped).toEqual({
      schedule: "income",
      line: IT3_SCHEDULE_MAP["Animal Sales"].line,
      code: "", // no per-line SARS codes on ITR12 (wave/26 fix)
    });
  });

  it("remaps 'Animal Purchases' onto the expense schedule regardless of tx.type", () => {
    // Default-categories has 'Animal Purchases' as type "income" (historical
    // quirk). The ITR12 calculator must still treat it as a cost-of-sales line.
    const mapped = mapTransactionToLine({
      type: "income",
      category: "Animal Purchases",
      amount: 30000,
      date: "2025-07-15",
    });
    expect(mapped?.schedule).toBe("expense");
    // 4201 was a fabricated code — removed in wave/26
    expect(mapped?.code).toBe("");
  });

  it("falls through to 'Other farming income' for unmapped income category", () => {
    const mapped = mapTransactionToLine({
      type: "income",
      category: "Wool Sales",
      amount: 12000,
      date: "2025-09-01",
    });
    expect(mapped).toEqual({
      schedule: "income",
      line: IT3_OTHER_INCOME_LINE.line,
      code: "", // no per-line codes (wave/26 fix)
    });
  });

  it("falls through to 'Other farming expenses' for unmapped expense category", () => {
    const mapped = mapTransactionToLine({
      type: "expense",
      category: "Mystery Expense",
      amount: 800,
      date: "2025-06-01",
    });
    expect(mapped).toEqual({
      schedule: "expense",
      line: IT3_OTHER_EXPENSE_LINE.line,
      code: "", // no per-line codes (wave/26 fix)
    });
  });

  it("returns null for zero-amount transactions", () => {
    expect(
      mapTransactionToLine({ type: "income", category: "Animal Sales", amount: 0, date: "2025-08-01" }),
    ).toBeNull();
  });

  it("returns null for unrecognised tx.type with unmapped category", () => {
    expect(
      mapTransactionToLine({ type: "transfer", category: "Internal", amount: 500, date: "2025-08-01" }),
    ).toBeNull();
  });
});

// ── computeIt3Schedules ───────────────────────────────────────────────────────

const FIXTURE_TRANSACTIONS: TransactionLike[] = [
  // Inside tax year 2026 (1 Mar 2025 – 28 Feb 2026)
  { type: "income",  category: "Animal Sales",           amount: 120_000, date: "2025-06-01" },
  { type: "income",  category: "Animal Sales",           amount:  80_000, date: "2025-09-15" },
  { type: "income",  category: "Subsidies",              amount:  15_000, date: "2025-10-01" },
  { type: "income",  category: "Animal Purchases",       amount:  40_000, date: "2025-05-20" }, // → expense
  { type: "expense", category: "Feed/Supplements",       amount:  22_000, date: "2025-07-10" },
  { type: "expense", category: "Medication/Vet",         amount:   3_500, date: "2025-08-05" },
  { type: "expense", category: "Labour",                 amount:  18_000, date: "2025-11-30" },
  { type: "expense", category: "Something Random",       amount:   1_200, date: "2025-12-01" }, // → Other expense
  // Inside boundary (start)
  { type: "expense", category: "Fuel/Transport",         amount:   2_500, date: "2025-03-01" },
  // Inside boundary (end)
  { type: "income",  category: "Livestock Production",   amount:   9_000, date: "2026-02-28" },
  // Outside — previous tax year, must be excluded
  { type: "income",  category: "Animal Sales",           amount: 999_999, date: "2025-02-28" },
  // Outside — next tax year, must be excluded
  { type: "expense", category: "Feed/Supplements",       amount: 777_777, date: "2026-03-01" },
  // Zero amount — excluded
  { type: "income",  category: "Animal Sales",           amount:       0, date: "2025-07-04" },
];

describe("computeIt3Schedules", () => {
  const result = computeIt3Schedules(FIXTURE_TRANSACTIONS, 2026);

  it("filters transactions to the requested tax year window only", () => {
    // 13 fixture rows, 2 outside window + 1 zero-amount = 10 included
    expect(result.transactionCount).toBe(10);
  });

  it("excludes the 999_999 row from the previous tax year", () => {
    // Look up by line text — no per-line codes in wave/26
    const sales = result.income.find((r) => r.line === IT3_SCHEDULE_MAP["Animal Sales"].line);
    expect(sales?.amount).toBe(120_000 + 80_000); // no 999_999 leak
  });

  it("excludes the 777_777 row from the next tax year", () => {
    const feed = result.expense.find((r) => r.line === IT3_SCHEDULE_MAP["Feed/Supplements"].line);
    expect(feed?.amount).toBe(22_000); // no 777_777 leak
  });

  it("includes 1 March start boundary", () => {
    const fuel = result.expense.find((r) => r.line === IT3_SCHEDULE_MAP["Fuel/Transport"].line);
    expect(fuel?.amount).toBe(2_500);
  });

  it("includes end-of-Feb boundary", () => {
    const livestock = result.income.find((r) => r.line === IT3_SCHEDULE_MAP["Livestock Production"].line);
    expect(livestock?.amount).toBe(9_000);
  });

  it("moves Animal Purchases onto the expense schedule", () => {
    const ap = result.expense.find((r) => r.line === IT3_SCHEDULE_MAP["Animal Purchases"].line);
    expect(ap?.amount).toBe(40_000);
    // …and does NOT appear in the income schedule
    expect(result.income.find((r) => r.line === IT3_SCHEDULE_MAP["Animal Purchases"].line)).toBeUndefined();
  });

  it("buckets unrecognised expense category into Other farming expenses", () => {
    const other = result.expense.find((r) => r.line === IT3_OTHER_EXPENSE_LINE.line);
    expect(other?.amount).toBe(1_200);
    expect(other?.sourceCategories).toContain("Something Random");
  });

  it("totals match schedule sums", () => {
    const incomeSum = result.income.reduce((s, r) => s + r.amount, 0);
    const expenseSum = result.expense.reduce((s, r) => s + r.amount, 0);
    expect(result.totalIncome).toBeCloseTo(incomeSum, 2);
    expect(result.totalExpenses).toBeCloseTo(expenseSum, 2);
    expect(result.netFarmingIncome).toBeCloseTo(incomeSum - expenseSum, 2);
  });

  it("reconciles: 120k+80k+15k+9k income; 40k+22k+3.5k+18k+1.2k+2.5k expense", () => {
    expect(result.totalIncome).toBe(224_000);
    expect(result.totalExpenses).toBe(87_200);
    expect(result.netFarmingIncome).toBe(136_800);
  });

  it("sorts schedule rows by line text ascending", () => {
    const lines = result.expense.map((r) => r.line);
    expect([...lines].sort()).toEqual(lines);
  });

  it("handles an empty transaction list", () => {
    const empty = computeIt3Schedules([], 2026);
    expect(empty.income).toEqual([]);
    expect(empty.expense).toEqual([]);
    expect(empty.totalIncome).toBe(0);
    expect(empty.totalExpenses).toBe(0);
    expect(empty.netFarmingIncome).toBe(0);
    expect(empty.transactionCount).toBe(0);
  });

  it("aggregates multiple transactions into the same line and counts contributions", () => {
    const sales = result.income.find((r) => r.line === IT3_SCHEDULE_MAP["Animal Sales"].line);
    expect(sales?.count).toBe(2); // two Animal Sales rows inside the window
  });
});

// ── formatZar ─────────────────────────────────────────────────────────────────

describe("formatZar", () => {
  it("formats whole-rand amounts with SA thousands separator", () => {
    expect(formatZar(224_000)).toBe("R 224 000.00");
  });

  it("includes cents", () => {
    expect(formatZar(1234.56)).toBe("R 1 234.56");
  });

  it("handles negatives", () => {
    expect(formatZar(-500)).toBe("-R 500.00");
  });

  it("handles zero", () => {
    expect(formatZar(0)).toBe("R 0.00");
  });
});
