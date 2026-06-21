/**
 * @vitest-environment node
 *
 * Wave 309c (ADR-0001 Wave B, #309) — domain op `getProfitabilityByAnimal`.
 *
 * Behaviour-preserving extraction from the old `lib/server/` module (which
 * had no test). This suite pins the fetch + partition logic that the route
 * adapter delegates to: tagged vs camp-level transaction partition, the
 * `type` lowercasing, the `animalId`-as-`tagNumber` mapping, and the
 * `dateRange` → `transaction.findMany` where-clause translation. The pure
 * allocation maths live in (and are tested by) the untouched calculator
 * `lib/calculators/profitability-per-animal.ts`; here it is mocked so the
 * assertions isolate the domain op's own forwarding contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("@/lib/calculators/profitability-per-animal", () => ({
  calcProfitabilityByAnimal: vi.fn(() => []),
}));

import { getProfitabilityByAnimal } from "../profitability-by-animal";
import { calcProfitabilityByAnimal } from "@/lib/calculators/profitability-per-animal";

describe("getProfitabilityByAnimal(prisma, dateRange?)", () => {
  const txFindMany = vi.fn();
  const animalFindMany = vi.fn();
  const prisma = {
    transaction: { findMany: txFindMany },
    animal: { findMany: animalFindMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    txFindMany.mockReset();
    animalFindMany.mockReset();
    vi.mocked(calcProfitabilityByAnimal).mockReset();
    vi.mocked(calcProfitabilityByAnimal).mockReturnValue([]);
    txFindMany.mockResolvedValue([]);
    animalFindMany.mockResolvedValue([]);
  });

  it("queries an empty txWhere + only Active animals when no dateRange given", async () => {
    await getProfitabilityByAnimal(prisma);

    expect(txFindMany).toHaveBeenCalledWith({
      where: {},
      select: { animalId: true, campId: true, type: true, amount: true, category: true },
    });
    expect(animalFindMany).toHaveBeenCalledWith({
      where: { status: "Active" },
      select: {
        animalId: true,
        name: true,
        category: true,
        currentCamp: true,
        purchasePrice: true,
      },
    });
  });

  it("translates dateRange into a gte/lte txWhere on date", async () => {
    await getProfitabilityByAnimal(prisma, {
      from: "2026-01-01",
      to: "2026-12-31",
    });

    expect(txFindMany).toHaveBeenCalledWith({
      where: { date: { gte: "2026-01-01", lte: "2026-12-31" } },
      select: { animalId: true, campId: true, type: true, amount: true, category: true },
    });
  });

  it("partitions tagged (animalId != null) vs camp-level (campId != null && animalId == null) transactions and lowercases type", async () => {
    txFindMany.mockResolvedValue([
      { animalId: "B042", campId: null, type: "Income", amount: 100, category: "Livestock Sales" },
      { animalId: null, campId: "C1", type: "EXPENSE", amount: 30, category: "Feed" },
      // animalId present AND campId present -> tagged (animalId wins)
      { animalId: "B007", campId: "C2", type: "Income", amount: 50, category: "Livestock Sales" },
      // neither -> belongs to neither partition
      { animalId: null, campId: null, type: "Income", amount: 9, category: "Other" },
    ]);
    animalFindMany.mockResolvedValue([]);

    await getProfitabilityByAnimal(prisma);

    expect(calcProfitabilityByAnimal).toHaveBeenCalledWith({
      taggedTransactions: [
        { animalId: "B042", type: "income", amount: 100, category: "Livestock Sales" },
        { animalId: "B007", type: "income", amount: 50, category: "Livestock Sales" },
      ],
      campTransactions: [{ campId: "C1", type: "expense", amount: 30 }],
      animals: [],
    });
  });

  it("maps animalId to tagNumber (no separate tagNumber field on Animal)", async () => {
    txFindMany.mockResolvedValue([]);
    animalFindMany.mockResolvedValue([
      {
        animalId: "B042",
        name: "Daisy",
        category: "Cow",
        currentCamp: "North",
        purchasePrice: 7500,
      },
    ]);

    await getProfitabilityByAnimal(prisma);

    expect(calcProfitabilityByAnimal).toHaveBeenCalledWith({
      taggedTransactions: [],
      campTransactions: [],
      animals: [
        {
          animalId: "B042",
          tagNumber: "B042",
          name: "Daisy",
          category: "Cow",
          currentCamp: "North",
          purchasePrice: 7500,
        },
      ],
    });
  });

  it("returns the calculator's rows verbatim", async () => {
    const rows = [
      { animalId: "B042", tagNumber: "B042", profit: 70 },
    ] as unknown as ReturnType<typeof calcProfitabilityByAnimal>;
    vi.mocked(calcProfitabilityByAnimal).mockReturnValue(rows);

    const result = await getProfitabilityByAnimal(prisma);

    expect(result).toBe(rows);
  });
});
