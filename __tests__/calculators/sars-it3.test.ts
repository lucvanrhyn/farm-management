/**
 * __tests__/calculators/sars-it3.test.ts
 *
 * TDD tests for wave-26 regulatory hotfix:
 *   Fix 1 — Replace fabricated SARS codes (4101..4299) with real ITR12 farming activity codes
 *   Fix 2 — ITR12 rename (user-visible strings)
 *
 * RED → GREEN → REFACTOR cycle.
 */

import { describe, it, expect } from "vitest";
import {
  IT3_SCHEDULE_MAP,
  IT3_OTHER_INCOME_LINE,
  IT3_OTHER_EXPENSE_LINE,
  getFarmingActivityCode,
  mapTransactionToLine,
  computeIt3Schedules,
  formatZar,
  getSaTaxYearRange,
  isInTaxYear,
  getRecentTaxYears,
} from "@/lib/calculators/sars-it3";

// ── Fix 1: getFarmingActivityCode ─────────────────────────────────────────────

describe("getFarmingActivityCode", () => {
  // Audit row #2+3: profit code 0104 Livestock Farming Profit
  it("returns 0104 for cattle dominant species with profit", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "cattle", netResult: "profit" })).toBe("0104");
  });

  it("returns 0105 for cattle dominant species with loss", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "cattle", netResult: "loss" })).toBe("0105");
  });

  it("returns 0140 for wool / sheep dominant species with profit", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "sheep", netResult: "profit" })).toBe("0140");
  });

  it("returns 0141 for wool / sheep dominant species with loss", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "sheep", netResult: "loss" })).toBe("0141");
  });

  it("returns 0142 for game dominant species with profit", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "game", netResult: "profit" })).toBe("0142");
  });

  it("returns 0143 for game dominant species with loss", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "game", netResult: "loss" })).toBe("0143");
  });

  it("returns 0108 for dairy/milk dominant species with profit", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "dairy", netResult: "profit" })).toBe("0108");
  });

  it("returns 0109 for dairy/milk dominant species with loss", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "dairy", netResult: "loss" })).toBe("0109");
  });

  it("returns 0114 for poultry dominant species with profit", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "poultry", netResult: "profit" })).toBe("0114");
  });

  it("returns 0115 for poultry dominant species with loss", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "poultry", netResult: "loss" })).toBe("0115");
  });

  it("returns 0102 for mixed/default (unknown species) with profit", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "unknown", netResult: "profit" })).toBe("0102");
  });

  it("returns 0103 for mixed/default (unknown species) with loss", () => {
    expect(getFarmingActivityCode({ dominantSpecies: "unknown", netResult: "loss" })).toBe("0103");
  });

  it("returns 0102 for null dominantSpecies with profit (default mixed)", () => {
    expect(getFarmingActivityCode({ dominantSpecies: null, netResult: "profit" })).toBe("0102");
  });

  it("returns 0102 for undefined dominantSpecies with profit (default mixed)", () => {
    expect(getFarmingActivityCode({ dominantSpecies: undefined, netResult: "profit" })).toBe("0102");
  });
});

// ── Fix 1: No fabricated 41xx/42xx codes anywhere ─────────────────────────────

describe("IT3_SCHEDULE_MAP — no fabricated SARS codes", () => {
  // Audit rows 4-20: codes 4101..4299 are all fabricated
  const FABRICATED_CODES = [
    "4101", "4102", "4103",
    "4201", "4202", "4203", "4204", "4205", "4206", "4207",
    "4199", "4299",
  ];

  it("IT3_SCHEDULE_MAP entries have no code property at all (codes dropped per Fix 1)", () => {
    for (const [key, entry] of Object.entries(IT3_SCHEDULE_MAP)) {
      expect(
        (entry as unknown as Record<string, unknown>).code,
        `IT3_SCHEDULE_MAP["${key}"] still has a fabricated .code field`
      ).toBeUndefined();
    }
  });

  it("IT3_OTHER_INCOME_LINE has no fabricated code (code field absent or empty)", () => {
    const code = (IT3_OTHER_INCOME_LINE as unknown as Record<string, unknown>).code;
    // Either undefined (field removed) or empty string (cleared) is acceptable
    expect(code === undefined || code === "").toBe(true);
  });

  it("IT3_OTHER_EXPENSE_LINE has no fabricated code (code field absent or empty)", () => {
    const code = (IT3_OTHER_EXPENSE_LINE as unknown as Record<string, unknown>).code;
    expect(code === undefined || code === "").toBe(true);
  });

  it("none of the specific fabricated codes appear in any schedule map entry", () => {
    for (const code of FABRICATED_CODES) {
      for (const [key, entry] of Object.entries(IT3_SCHEDULE_MAP)) {
        expect(
          (entry as unknown as Record<string, unknown>).code,
          `Code ${code} appeared in IT3_SCHEDULE_MAP["${key}"]`
        ).not.toBe(code);
      }
    }
  });

  it("mapTransactionToLine no longer returns a fabricated 41xx/42xx code", () => {
    const tx = { type: "income" as const, category: "Animal Sales", amount: 1000, date: "2025-06-01" };
    const result = mapTransactionToLine(tx);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.code).not.toMatch(/^4[12]\d{2}$/);
    }
  });

  it("mapTransactionToLine for unmapped income category does not return fabricated code", () => {
    const tx = { type: "income" as const, category: "Some Random Income", amount: 500, date: "2025-06-01" };
    const result = mapTransactionToLine(tx);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.code).not.toMatch(/^4[12]\d{2}$/);
    }
  });
});

// ── Fix 1: computeIt3Schedules includes farmingActivityCode ───────────────────

describe("computeIt3Schedules — farmingActivityCode in result", () => {
  const transactions = [
    { type: "income" as const, category: "Animal Sales", amount: 10000, date: "2025-06-01" },
    { type: "expense" as const, category: "Feed/Supplements", amount: 2000, date: "2025-08-01" },
  ];

  it("result includes farmingActivityCode field derived from dominant species", () => {
    const result = computeIt3Schedules(transactions, 2026, { dominantSpecies: "cattle" });
    expect(result.farmingActivityCode).toBeDefined();
    expect(result.farmingActivityCode).toMatch(/^0[12]\d{2}$/); // real SARS code format
  });

  it("farmingActivityCode is 0104 for cattle with profit", () => {
    const result = computeIt3Schedules(transactions, 2026, { dominantSpecies: "cattle" });
    expect(result.farmingActivityCode).toBe("0104");
  });

  it("farmingActivityCode is 0102 when no dominantSpecies given (mixed farming profit)", () => {
    const result = computeIt3Schedules(transactions, 2026);
    expect(result.farmingActivityCode).toBe("0102");
  });

  it("farmingActivityCode is 0105 for cattle with net loss", () => {
    const lossTransactions = [
      { type: "income" as const, category: "Animal Sales", amount: 100, date: "2025-06-01" },
      { type: "expense" as const, category: "Feed/Supplements", amount: 5000, date: "2025-08-01" },
    ];
    const result = computeIt3Schedules(lossTransactions, 2026, { dominantSpecies: "cattle" });
    expect(result.farmingActivityCode).toBe("0105");
  });
});

// ── Existing behaviour preserved ──────────────────────────────────────────────

describe("existing behaviour still works after code changes", () => {
  it("getSaTaxYearRange returns correct dates for 2026", () => {
    const { start, end } = getSaTaxYearRange(2026);
    expect(start).toBe("2025-03-01");
    expect(end).toBe("2026-02-28");
  });

  it("getSaTaxYearRange handles leap year 2024", () => {
    const { start, end } = getSaTaxYearRange(2024);
    expect(start).toBe("2023-03-01");
    expect(end).toBe("2024-02-29");
  });

  it("isInTaxYear correctly filters dates", () => {
    // Tax year 2026 = 2025-03-01 to 2026-02-28
    expect(isInTaxYear("2025-06-01", 2026)).toBe(true);  // within 2026 tax year
    expect(isInTaxYear("2025-03-01", 2026)).toBe(true);  // first day of 2026 tax year
    expect(isInTaxYear("2026-02-28", 2026)).toBe(true);  // last day of 2026 tax year
    expect(isInTaxYear("2025-02-28", 2026)).toBe(false); // belongs to tax year 2025
    expect(isInTaxYear("2024-12-31", 2026)).toBe(false); // belongs to tax year 2025
    expect(isInTaxYear("2026-03-01", 2026)).toBe(false); // first day of tax year 2027
  });

  it("getRecentTaxYears returns correct years", () => {
    const years = getRecentTaxYears(new Date("2026-04-30"), 3);
    expect(years).toEqual([2027, 2026, 2025]);
  });

  it("formatZar formats positive amounts correctly", () => {
    expect(formatZar(1234567.89)).toBe("R 1 234 567.89");
  });

  it("mapTransactionToLine returns null for zero-amount transaction", () => {
    expect(mapTransactionToLine({ type: "income", category: "Animal Sales", amount: 0, date: "2025-06-01" })).toBeNull();
  });

  it("IT3_SCHEDULE_MAP has all expected category keys", () => {
    const expectedKeys = [
      "Animal Sales", "Livestock Production", "Subsidies",
      "Animal Purchases", "Feed/Supplements", "Medication/Vet",
      "Labour", "Fuel/Transport", "Equipment/Repairs", "Camp Maintenance",
    ];
    for (const key of expectedKeys) {
      expect(IT3_SCHEDULE_MAP[key], `Missing key: ${key}`).toBeDefined();
    }
  });

  it("IT3_SCHEDULE_MAP entries have schedule and line fields", () => {
    for (const [key, entry] of Object.entries(IT3_SCHEDULE_MAP)) {
      expect(entry.schedule, `Missing schedule on ${key}`).toMatch(/^(income|expense)$/);
      expect(entry.line, `Missing line on ${key}`).toBeTruthy();
    }
  });
});
