/**
 * @vitest-environment jsdom
 *
 * Unit tests for the pure category-rollup helper that backs the Category axis
 * of /admin/profitability. jsdom env because the helper is exported from a
 * "use client" .tsx module (which transitively imports React/next-link); the
 * function itself is pure and clock-free.
 */
import { describe, it, expect } from "vitest";
import { rollUpProfitByCategory } from "@/components/admin/profitability/ProfitabilityClient";
import type { AnimalProfitabilityViewRow } from "@/lib/domain/transactions/animal-profitability-view";

function row(over: Partial<AnimalProfitabilityViewRow>): AnimalProfitabilityViewRow {
  return {
    animalId: "A1",
    tagNumber: "A1",
    name: null,
    category: "Cow",
    status: "Active",
    income: 0,
    expenses: 0,
    realisedMargin: 0,
    projectedValue: null,
    projectedMargin: null,
    projectedBasis: "none",
    ...over,
  };
}

describe("rollUpProfitByCategory", () => {
  it("returns empty for no rows", () => {
    expect(rollUpProfitByCategory([])).toEqual([]);
  });

  it("sums realised income/expenses/margin and head count per category", () => {
    const out = rollUpProfitByCategory([
      row({ animalId: "C1", category: "Cow", income: 1000, expenses: 300, realisedMargin: 700 }),
      row({ animalId: "C2", category: "Cow", income: 500, expenses: 200, realisedMargin: 300 }),
      row({ animalId: "B1", category: "Bull", income: 2000, expenses: 100, realisedMargin: 1900 }),
    ]);
    const cow = out.find((r) => r.category === "Cow")!;
    const bull = out.find((r) => r.category === "Bull")!;
    expect(cow.headCount).toBe(2);
    expect(cow.income).toBe(1500);
    expect(cow.expenses).toBe(500);
    expect(cow.realisedMargin).toBe(1000);
    expect(bull.headCount).toBe(1);
    expect(bull.realisedMargin).toBe(1900);
  });

  it("sums projected ONLY over live (non-null) rows — disposed rows never inflate projected", () => {
    const out = rollUpProfitByCategory([
      // live animal carries a projected figure
      row({ animalId: "C1", category: "Cow", expenses: 100, realisedMargin: -100, projectedValue: 9000, projectedMargin: 8900, projectedBasis: "per-kg" }),
      // disposed animal — realised banked, projected null (must be skipped)
      row({ animalId: "C2", category: "Cow", status: "Sold", income: 5000, realisedMargin: 5000, projectedValue: null, projectedMargin: null }),
    ]);
    const cow = out.find((r) => r.category === "Cow")!;
    expect(cow.headCount).toBe(2);
    expect(cow.realisedMargin).toBe(4900); // -100 + 5000, spans both statuses
    expect(cow.projectedValue).toBe(9000); // ONLY the live animal
    expect(cow.projectedMargin).toBe(8900);
    expect(cow.projectedCount).toBe(1); // disposed animal excluded
  });

  it("buckets blank/whitespace category under 'Uncategorised'", () => {
    const out = rollUpProfitByCategory([
      row({ animalId: "X1", category: "", realisedMargin: 10 }),
      row({ animalId: "X2", category: "   ", realisedMargin: 20 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("Uncategorised");
    expect(out[0].headCount).toBe(2);
    expect(out[0].realisedMargin).toBe(30);
  });

  it("orders by realised margin desc, then category name asc on ties", () => {
    const out = rollUpProfitByCategory([
      row({ animalId: "L1", category: "Loss", realisedMargin: -500 }),
      row({ animalId: "H1", category: "High", realisedMargin: 900 }),
      row({ animalId: "T1", category: "TieB", realisedMargin: 100 }),
      row({ animalId: "T2", category: "TieA", realisedMargin: 100 }),
    ]);
    expect(out.map((r) => r.category)).toEqual(["High", "TieA", "TieB", "Loss"]);
  });
});
