/**
 * __tests__/calculators/sars-it3-with-stock.test.ts
 *
 * TDD tests for the wave-26b stock-movement integration into computeIt3Schedules:
 *
 *     net = grossSales - allowableDeductions + (closingStock - openingStock)
 *
 * per First Schedule paragraph 5(1) read with paragraph 2 + paragraph 3.
 *
 * The earlier shipped behaviour (`net = totalIncome - totalExpenses`) is wrong
 * by exactly the stock movement. Wave 26b makes the stock movement opt-in via
 * a new `stockMovement` option on computeIt3Schedules so existing callers can
 * be migrated without breaking.
 */

import { describe, it, expect } from "vitest";
import {
  computeIt3Schedules,
  type TransactionLike,
} from "@/lib/calculators/sars-it3";
import type { StockMovementSummary } from "@/lib/calculators/sars-stock";

const taxYear = 2026;

const txs: TransactionLike[] = [
  { type: "income", category: "Animal Sales", amount: 50_000, date: "2025-06-01" },
  { type: "expense", category: "Feed/Supplements", amount: 10_000, date: "2025-09-01" },
];

describe("computeIt3Schedules — without stockMovement", () => {
  it("preserves existing behaviour (net = income - expenses)", () => {
    const result = computeIt3Schedules(txs, taxYear);
    expect(result.totalIncome).toBe(50_000);
    expect(result.totalExpenses).toBe(10_000);
    expect(result.netFarmingIncome).toBe(40_000);
    expect(result.openingStockValueZar).toBeUndefined();
    expect(result.closingStockValueZar).toBeUndefined();
    expect(result.stockMovementZar).toBeUndefined();
  });
});

describe("computeIt3Schedules — with stockMovement", () => {
  it("adds positive stock delta to netFarmingIncome (closing > opening)", () => {
    const stockMovement: StockMovementSummary = {
      openingStockValueZar: 5_000, // 100 bulls × R50
      closingStockValueZar: 10_000, // 200 bulls × R50
      deltaZar: 5_000,
    };
    const result = computeIt3Schedules(txs, taxYear, { stockMovement });
    expect(result.netFarmingIncomeBeforeStockMovement).toBe(40_000);
    expect(result.openingStockValueZar).toBe(5_000);
    expect(result.closingStockValueZar).toBe(10_000);
    expect(result.stockMovementZar).toBe(5_000);
    expect(result.netFarmingIncome).toBe(45_000); // 40000 + 5000
  });

  it("subtracts negative stock delta from netFarmingIncome (closing < opening)", () => {
    const stockMovement: StockMovementSummary = {
      openingStockValueZar: 10_000,
      closingStockValueZar: 5_000,
      deltaZar: -5_000,
    };
    const result = computeIt3Schedules(txs, taxYear, { stockMovement });
    expect(result.netFarmingIncome).toBe(35_000); // 40000 + (-5000)
    expect(result.stockMovementZar).toBe(-5_000);
  });

  it("zero delta does not change netFarmingIncome", () => {
    const stockMovement: StockMovementSummary = {
      openingStockValueZar: 5_000,
      closingStockValueZar: 5_000,
      deltaZar: 0,
    };
    const result = computeIt3Schedules(txs, taxYear, { stockMovement });
    expect(result.netFarmingIncome).toBe(40_000);
    expect(result.stockMovementZar).toBe(0);
  });

  it("loss flips farmingActivityCode when stock movement turns profit into loss", () => {
    const stockMovement: StockMovementSummary = {
      openingStockValueZar: 100_000,
      closingStockValueZar: 0,
      deltaZar: -100_000,
    };
    const result = computeIt3Schedules(txs, taxYear, {
      stockMovement,
      dominantSpecies: "cattle",
    });
    expect(result.netFarmingIncome).toBe(-60_000);
    expect(result.farmingActivityCode).toBe("0105"); // cattle loss
  });
});
