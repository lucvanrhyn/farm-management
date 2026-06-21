/**
 * @vitest-environment node
 *
 * Wave animal-mob-profitability — disposed-inclusive + projected per-animal view.
 *
 * Pins: the disposed-inclusive roster predicate (banked margin from a Sold
 * animal surfaces), the purchasePrice column-wins reconciliation flowing
 * through, the latest-weighing projection for Active animals only, and the
 * honesty invariant that disposed animals carry null projection.
 *
 * crossSpecies is mocked to route .animal/.observation to plain prisma mocks so
 * the assertions isolate this op's fetch + assembly contract. The pure
 * calculators (estimateSaleValue, calcProfitabilityByAnimal) are exercised for
 * real — they are the math being verified end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const animalFindMany = vi.fn();
const observationFindMany = vi.fn();

vi.mock("@/lib/server/species-scoped-prisma", () => ({
  crossSpecies: () => ({
    animal: { findMany: animalFindMany },
    observation: { findMany: observationFindMany },
  }),
}));

import { getAnimalProfitabilityView } from "../animal-profitability-view";

describe("getAnimalProfitabilityView(prisma, dateRange?)", () => {
  const txFindMany = vi.fn();
  const settingsFindFirst = vi.fn();
  const prisma = {
    transaction: { findMany: txFindMany },
    farmSettings: { findFirst: settingsFindFirst },
  } as unknown as PrismaClient;

  beforeEach(() => {
    txFindMany.mockReset().mockResolvedValue([]);
    animalFindMany.mockReset().mockResolvedValue([]);
    observationFindMany.mockReset().mockResolvedValue([]);
    settingsFindFirst.mockReset().mockResolvedValue({ speciesAlertThresholds: null });
  });

  it("uses the disposed-inclusive roster predicate (Active+Sold+Deceased+Culled)", async () => {
    await getAnimalProfitabilityView(prisma);
    expect(animalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["Active", "Sold", "Deceased", "Culled"] } },
      }),
    );
  });

  it("translates dateRange into a gte/lte txWhere on date", async () => {
    await getAnimalProfitabilityView(prisma, { from: "2026-01-01", to: "2026-12-31" });
    expect(txFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date: { gte: "2026-01-01", lte: "2026-12-31" } },
      }),
    );
  });

  it("surfaces banked sale margin for a SOLD animal and gives it a null projection", async () => {
    animalFindMany.mockResolvedValue([
      {
        animalId: "S1",
        name: "Sold One",
        category: "Steers",
        currentCamp: "camp-1",
        status: "Sold",
        species: "cattle",
        purchasePrice: 6000,
        estimatedValue: null,
      },
    ]);
    txFindMany.mockResolvedValue([
      { animalId: "S1", campId: null, type: "income", amount: 14000, category: "Livestock Sales" },
      // a tagged purchase tx that must be skipped because purchasePrice column wins
      { animalId: "S1", campId: null, type: "expense", amount: 5500, category: "Animal Purchases" },
    ]);

    const rows = await getAnimalProfitabilityView(prisma);
    const s1 = rows.find((r) => r.animalId === "S1")!;
    expect(s1.income).toBe(14000);
    expect(s1.expenses).toBe(6000); // purchasePrice column wins, 5500 purchase tx skipped
    expect(s1.realisedMargin).toBe(8000);
    // Disposed -> no projection.
    expect(s1.projectedValue).toBeNull();
    expect(s1.projectedMargin).toBeNull();
    expect(s1.projectedBasis).toBe("none");
    // does not fetch weighings for a roster with no Active animals
    expect(observationFindMany).not.toHaveBeenCalled();
  });

  it("projects an ACTIVE animal per-kg from its latest weighing × default price", async () => {
    animalFindMany.mockResolvedValue([
      {
        animalId: "A1",
        name: "Live One",
        category: "Cows",
        currentCamp: "camp-1",
        status: "Active",
        species: "cattle",
        purchasePrice: null,
        estimatedValue: null,
      },
    ]);
    txFindMany.mockResolvedValue([
      { animalId: "A1", campId: null, type: "expense", amount: 1000, category: "Vet" },
    ]);
    observationFindMany.mockResolvedValue([
      { animalId: "A1", details: JSON.stringify({ weight_kg: 300 }) },
      { animalId: "A1", details: JSON.stringify({ weight_kg: 450 }) }, // latest (asc order)
    ]);

    const rows = await getAnimalProfitabilityView(prisma);
    const a1 = rows.find((r) => r.animalId === "A1")!;
    expect(a1.expenses).toBe(1000);
    expect(a1.projectedBasis).toBe("per-kg");
    expect(a1.projectedValue).toBe(450 * 45); // default cattle R/kg
    expect(a1.projectedMargin).toBe(450 * 45 - 1000);
  });

  it("reads a task-completion weighing stored under camelCase `weightKg` (per-kg, not per-head)", async () => {
    // Weighings from completed weighing-tasks persist details as { weightKg }
    // (camelCase) while the logger/modal writes { weight_kg }. The projection
    // must read both or such an animal silently degrades to per-head.
    animalFindMany.mockResolvedValue([
      {
        animalId: "TW1",
        name: null,
        category: "Cows",
        currentCamp: "camp-1",
        status: "Active",
        species: "cattle",
        purchasePrice: null,
        estimatedValue: null,
      },
    ]);
    observationFindMany.mockResolvedValue([
      { animalId: "TW1", details: JSON.stringify({ weightKg: 500 }) },
    ]);

    const rows = await getAnimalProfitabilityView(prisma);
    const tw1 = rows.find((r) => r.animalId === "TW1")!;
    expect(tw1.projectedBasis).toBe("per-kg");
    expect(tw1.projectedValue).toBe(500 * 45);
  });

  it("does NOT charge a disposed animal a share of camp-tagged expenses (active-only split)", async () => {
    // A Sold animal keeps its last currentCamp; a camp-tagged expense must fall
    // entirely on the Active animal still in that camp, not be split 50/50.
    animalFindMany.mockResolvedValue([
      { animalId: "LIVE", name: null, category: "Cows", currentCamp: "camp-1", status: "Active", species: "cattle", purchasePrice: null, estimatedValue: null },
      { animalId: "GONE", name: null, category: "Cows", currentCamp: "camp-1", status: "Sold", species: "cattle", purchasePrice: null, estimatedValue: null },
    ]);
    txFindMany.mockResolvedValue([
      { animalId: null, campId: "camp-1", type: "expense", amount: 1000, category: "Feed" },
    ]);

    const rows = await getAnimalProfitabilityView(prisma);
    const live = rows.find((r) => r.animalId === "LIVE")!;
    const gone = rows.find((r) => r.animalId === "GONE")!;
    expect(live.expenses).toBe(1000); // sole active camp member bears the full cost
    expect(gone.expenses).toBe(0); // disposed: no share of post-disposal camp cost
  });

  it("returns rows sorted by realised margin descending", async () => {
    animalFindMany.mockResolvedValue([
      { animalId: "LOW", name: null, category: "Cows", currentCamp: "c", status: "Active", species: "cattle", purchasePrice: null, estimatedValue: null },
      { animalId: "HIGH", name: null, category: "Cows", currentCamp: "c", status: "Active", species: "cattle", purchasePrice: null, estimatedValue: null },
    ]);
    txFindMany.mockResolvedValue([
      { animalId: "LOW", campId: null, type: "expense", amount: 500, category: "Vet" },
      { animalId: "HIGH", campId: null, type: "income", amount: 9000, category: "Livestock Sales" },
    ]);
    observationFindMany.mockResolvedValue([]);

    const rows = await getAnimalProfitabilityView(prisma);
    expect(rows.map((r) => r.animalId)).toEqual(["HIGH", "LOW"]);
  });

  it("uses the per-animal estimatedValue override over weight-based per-kg", async () => {
    animalFindMany.mockResolvedValue([
      {
        animalId: "STUD",
        name: "Champ",
        category: "Bulls",
        currentCamp: "camp-2",
        status: "Active",
        species: "cattle",
        purchasePrice: null,
        estimatedValue: 80000,
      },
    ]);
    observationFindMany.mockResolvedValue([
      { animalId: "STUD", details: JSON.stringify({ weight_kg: 900 }) },
    ]);

    const rows = await getAnimalProfitabilityView(prisma);
    const stud = rows.find((r) => r.animalId === "STUD")!;
    expect(stud.projectedBasis).toBe("override");
    expect(stud.projectedValue).toBe(80000);
  });

  it("falls back to per-head for an ACTIVE animal with no weighing on record", async () => {
    animalFindMany.mockResolvedValue([
      {
        animalId: "NW1",
        name: null,
        category: "Heifers",
        currentCamp: "camp-1",
        status: "Active",
        species: "cattle",
        purchasePrice: null,
        estimatedValue: null,
      },
    ]);
    observationFindMany.mockResolvedValue([]); // no weights

    const rows = await getAnimalProfitabilityView(prisma);
    const nw1 = rows.find((r) => r.animalId === "NW1")!;
    expect(nw1.projectedBasis).toBe("per-head");
    expect(nw1.projectedValue).toBe(11000); // default cattle per-head
  });

  it("resolves marketPricePerKg + valuePerHead from the speciesAlertThresholds settings blob", async () => {
    settingsFindFirst.mockResolvedValue({
      speciesAlertThresholds: JSON.stringify({
        cattle: { marketPricePerKg: 50 },
        sheep: { valuePerHead: 2200 },
      }),
    });
    animalFindMany.mockResolvedValue([
      {
        animalId: "C1",
        name: null,
        category: "Cows",
        currentCamp: "camp-1",
        status: "Active",
        species: "cattle",
        purchasePrice: null,
        estimatedValue: null,
      },
      {
        animalId: "SH1",
        name: null,
        category: "Ewes",
        currentCamp: "camp-3",
        status: "Active",
        species: "sheep",
        purchasePrice: null,
        estimatedValue: null,
      },
    ]);
    observationFindMany.mockResolvedValue([
      { animalId: "C1", details: JSON.stringify({ weight_kg: 400 }) },
      // SH1 has no weighing -> per-head
    ]);

    const rows = await getAnimalProfitabilityView(prisma);
    const c1 = rows.find((r) => r.animalId === "C1")!;
    const sh1 = rows.find((r) => r.animalId === "SH1")!;
    expect(c1.projectedValue).toBe(400 * 50); // settings R/kg
    expect(sh1.projectedValue).toBe(2200); // settings per-head
  });

  it("never sums projected with realised — projected fields are independent of income", async () => {
    animalFindMany.mockResolvedValue([
      {
        animalId: "A1",
        name: null,
        category: "Cows",
        currentCamp: "camp-1",
        status: "Active",
        species: "cattle",
        purchasePrice: null,
        estimatedValue: null,
      },
    ]);
    txFindMany.mockResolvedValue([
      { animalId: "A1", campId: null, type: "income", amount: 5000, category: "Other Income" },
    ]);
    observationFindMany.mockResolvedValue([]);

    const rows = await getAnimalProfitabilityView(prisma);
    const a1 = rows.find((r) => r.animalId === "A1")!;
    expect(a1.income).toBe(5000);
    expect(a1.realisedMargin).toBe(5000);
    // projected margin = projectedValue - expenses, NOT touched by income
    expect(a1.projectedValue).toBe(11000); // per-head default (no weight)
    expect(a1.projectedMargin).toBe(11000 - 0);
  });
});
