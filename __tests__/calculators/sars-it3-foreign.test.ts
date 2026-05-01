/**
 * __tests__/calculators/sars-it3-foreign.test.ts
 *
 * TDD tests for wave/26e (refs #26 audit finding #22):
 *   Foreign farming income SARS source codes 0192 (profit) / 0193 (loss).
 *
 * SARS uses 0192/0193 to identify farming income earned outside South Africa
 * (e.g. SA farmers leasing land in Lesotho/Eswatini). FarmTrack tracks foreign
 * derivation via a per-Transaction `isForeign` boolean. When any foreign-flagged
 * transactions exist for the period, computeIt3Schedules() must:
 *   1. Exclude them from the main domestic income/expense/net totals.
 *   2. Aggregate them into a parallel `foreignFarmingIncome` block carrying
 *      its own activity code (0192/0193).
 *
 * Reference: SARS "Find a Source Code"
 *   https://www.sars.gov.za/types-of-tax/personal-income-tax/filing-season/find-a-source-code/
 */

import { describe, it, expect } from "vitest";
import {
  getFarmingActivityCode,
  splitTransactionsByForeignness,
  computeIt3Schedules,
  type TransactionLike,
} from "@/lib/calculators/sars-it3";

// ── getFarmingActivityCode: foreign codes ─────────────────────────────────────

describe("getFarmingActivityCode — foreign farming income (wave/26e)", () => {
  it("returns 0192 for foreign-derived farming income with profit", () => {
    expect(
      getFarmingActivityCode({ dominantSpecies: "foreign", netResult: "profit" }),
    ).toBe("0192");
  });

  it("returns 0193 for foreign-derived farming income with loss", () => {
    expect(
      getFarmingActivityCode({ dominantSpecies: "foreign", netResult: "loss" }),
    ).toBe("0193");
  });

  it("treats 'Foreign' (uppercase) the same as 'foreign' (case-insensitive)", () => {
    expect(
      getFarmingActivityCode({ dominantSpecies: "Foreign", netResult: "profit" }),
    ).toBe("0192");
  });
});

// ── splitTransactionsByForeignness ────────────────────────────────────────────

describe("splitTransactionsByForeignness", () => {
  it("partitions an empty list into two empty buckets", () => {
    const out = splitTransactionsByForeignness([]);
    expect(out.domestic).toEqual([]);
    expect(out.foreign).toEqual([]);
  });

  it("treats undefined isForeign as domestic (backward-compat)", () => {
    const txs: TransactionLike[] = [
      { type: "income", category: "Animal Sales", amount: 100, date: "2025-06-01" },
      { type: "expense", category: "Feed/Supplements", amount: 50, date: "2025-06-02" },
    ];
    const out = splitTransactionsByForeignness(txs);
    expect(out.domestic).toHaveLength(2);
    expect(out.foreign).toHaveLength(0);
  });

  it("treats false isForeign as domestic", () => {
    const txs: TransactionLike[] = [
      { type: "income", category: "Animal Sales", amount: 100, date: "2025-06-01", isForeign: false },
    ];
    const out = splitTransactionsByForeignness(txs);
    expect(out.domestic).toHaveLength(1);
    expect(out.foreign).toHaveLength(0);
  });

  it("partitions a mixed list correctly", () => {
    const txs: TransactionLike[] = [
      { type: "income", category: "Animal Sales", amount: 100, date: "2025-06-01" },
      { type: "income", category: "Animal Sales", amount: 200, date: "2025-06-02", isForeign: true },
      { type: "expense", category: "Feed/Supplements", amount: 50, date: "2025-06-03", isForeign: true },
      { type: "expense", category: "Labour", amount: 30, date: "2025-06-04", isForeign: false },
    ];
    const out = splitTransactionsByForeignness(txs);
    expect(out.domestic).toHaveLength(2);
    expect(out.foreign).toHaveLength(2);
    expect(out.foreign[0].amount).toBe(200);
    expect(out.foreign[1].amount).toBe(50);
    expect(out.domestic[0].amount).toBe(100);
    expect(out.domestic[1].amount).toBe(30);
  });
});

// ── computeIt3Schedules with foreignFarmingIncome ─────────────────────────────

describe("computeIt3Schedules — foreignFarmingIncome block (wave/26e)", () => {
  const TAX_YEAR = 2026; // 2025-03-01..2026-02-28

  it("returns foreignFarmingIncome: null when no foreign transactions exist", () => {
    const txs: TransactionLike[] = [
      { type: "income", category: "Animal Sales", amount: 1000, date: "2025-06-01" },
      { type: "expense", category: "Feed/Supplements", amount: 200, date: "2025-06-02" },
    ];
    const out = computeIt3Schedules(txs, TAX_YEAR, { dominantSpecies: "cattle" });
    expect(out.foreignFarmingIncome).toBeNull();
    expect(out.totalIncome).toBe(1000);
    expect(out.totalExpenses).toBe(200);
  });

  it("excludes foreign tx from domestic totals and rolls them into foreignFarmingIncome", () => {
    const txs: TransactionLike[] = [
      // Domestic
      { type: "income", category: "Animal Sales", amount: 1000, date: "2025-06-01" },
      { type: "expense", category: "Feed/Supplements", amount: 200, date: "2025-06-02" },
      // Foreign (Lesotho lease)
      { type: "income", category: "Animal Sales", amount: 500, date: "2025-07-15", isForeign: true },
      { type: "expense", category: "Medication/Vet", amount: 80, date: "2025-07-16", isForeign: true },
    ];
    const out = computeIt3Schedules(txs, TAX_YEAR, { dominantSpecies: "cattle" });

    // Domestic totals exclude foreign amounts
    expect(out.totalIncome).toBe(1000);
    expect(out.totalExpenses).toBe(200);
    expect(out.farmingActivityCode).toBe("0104"); // cattle profit (domestic)

    // Foreign block populated
    expect(out.foreignFarmingIncome).not.toBeNull();
    expect(out.foreignFarmingIncome!.totalIncome).toBe(500);
    expect(out.foreignFarmingIncome!.totalExpenses).toBe(80);
    expect(out.foreignFarmingIncome!.net).toBe(420);
    expect(out.foreignFarmingIncome!.activityCode).toBe("0192"); // profit
    expect(out.foreignFarmingIncome!.income).toHaveLength(1);
    expect(out.foreignFarmingIncome!.expense).toHaveLength(1);
  });

  it("uses 0193 for foreign loss", () => {
    const txs: TransactionLike[] = [
      { type: "income", category: "Animal Sales", amount: 100, date: "2025-06-01" },
      { type: "income", category: "Animal Sales", amount: 50, date: "2025-07-15", isForeign: true },
      { type: "expense", category: "Feed/Supplements", amount: 200, date: "2025-07-16", isForeign: true },
    ];
    const out = computeIt3Schedules(txs, TAX_YEAR, { dominantSpecies: "cattle" });
    expect(out.foreignFarmingIncome).not.toBeNull();
    expect(out.foreignFarmingIncome!.net).toBe(-150);
    expect(out.foreignFarmingIncome!.activityCode).toBe("0193"); // loss
  });

  it("returns near-zero domestic + populated foreign block for all-foreign data", () => {
    const txs: TransactionLike[] = [
      { type: "income", category: "Animal Sales", amount: 1000, date: "2025-06-01", isForeign: true },
      { type: "expense", category: "Feed/Supplements", amount: 200, date: "2025-06-02", isForeign: true },
    ];
    const out = computeIt3Schedules(txs, TAX_YEAR, { dominantSpecies: "cattle" });
    expect(out.totalIncome).toBe(0);
    expect(out.totalExpenses).toBe(0);
    expect(out.foreignFarmingIncome).not.toBeNull();
    expect(out.foreignFarmingIncome!.totalIncome).toBe(1000);
    expect(out.foreignFarmingIncome!.totalExpenses).toBe(200);
    expect(out.foreignFarmingIncome!.net).toBe(800);
    expect(out.foreignFarmingIncome!.activityCode).toBe("0192");
  });

  it("ignores foreign transactions outside the tax year window", () => {
    const txs: TransactionLike[] = [
      { type: "income", category: "Animal Sales", amount: 100, date: "2025-06-01" },
      // Out of window — would have been a foreign loss but is excluded
      { type: "expense", category: "Feed/Supplements", amount: 9999, date: "2024-01-01", isForeign: true },
    ];
    const out = computeIt3Schedules(txs, TAX_YEAR, { dominantSpecies: "cattle" });
    expect(out.totalIncome).toBe(100);
    expect(out.foreignFarmingIncome).toBeNull();
  });

  it("does not affect netFarmingIncome when foreign tx exist (foreign is parallel reporting)", () => {
    const txs: TransactionLike[] = [
      { type: "income", category: "Animal Sales", amount: 1000, date: "2025-06-01" },
      { type: "expense", category: "Feed/Supplements", amount: 200, date: "2025-06-02" },
      { type: "income", category: "Animal Sales", amount: 99999, date: "2025-07-01", isForeign: true },
    ];
    const out = computeIt3Schedules(txs, TAX_YEAR, { dominantSpecies: "cattle" });
    expect(out.netFarmingIncome).toBe(800); // 1000-200 — foreign R99,999 NOT included
  });
});
