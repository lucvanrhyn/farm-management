import { describe, it, expect } from "vitest";
import {
  attributeAmountsToCamps,
  rollUpProfitByCamp,
  type ProfitTxInput,
  type ProfitPerCampRollupInput,
} from "@/lib/calculators/profit-per-camp";

// ── attributeAmountsToCamps — the last-camp attribution engine ───────────────

const ANIMAL_CAMP: Record<string, string> = {
  A1: "camp-1", // finished in camp-1
  A2: "camp-2", // finished in camp-2
  A3: "camp-1",
};

describe("attributeAmountsToCamps — last-camp rule", () => {
  it("credits a single-animal tx to that animal's current camp", () => {
    const txs: ProfitTxInput[] = [
      { type: "income", amount: 5000, animalId: "A1" },
    ];
    const { byCamp, unallocated } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.get("camp-1")).toBe(5000);
    expect(unallocated).toBe(0);
  });

  it("splits a batch (animalIds) evenly, each share to that animal's own camp", () => {
    // A1 -> camp-1, A2 -> camp-2. R6000 split evenly = R3000 each.
    const txs: ProfitTxInput[] = [
      { type: "income", amount: 6000, animalIds: JSON.stringify(["A1", "A2"]) },
    ];
    const { byCamp, unallocated } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.get("camp-1")).toBe(3000);
    expect(byCamp.get("camp-2")).toBe(3000);
    expect(unallocated).toBe(0);
  });

  it("aggregates two batch animals that share a camp into one camp total", () => {
    // A1 + A3 both finish in camp-1; R4000 split = R2000 each = R4000 to camp-1.
    const txs: ProfitTxInput[] = [
      { type: "income", amount: 4000, animalIds: JSON.stringify(["A1", "A3"]) },
    ];
    const { byCamp } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.get("camp-1")).toBe(4000);
  });

  it("honours an explicit campId on the tx", () => {
    const txs: ProfitTxInput[] = [
      { type: "income", amount: 1500, campId: "camp-5" },
    ];
    const { byCamp, unallocated } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.get("camp-5")).toBe(1500);
    expect(unallocated).toBe(0);
  });

  it("attributes an animalId-tagged cost to that animal's last camp (symmetry)", () => {
    const txs: ProfitTxInput[] = [
      { type: "expense", amount: 800, animalId: "A2" },
    ];
    const { byCamp } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.get("camp-2")).toBe(800);
  });

  it("attributes a campId-tagged cost to that camp", () => {
    const txs: ProfitTxInput[] = [
      { type: "expense", amount: 1200, campId: "camp-1" },
    ];
    const { byCamp } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.get("camp-1")).toBe(1200);
  });

  it("buckets a tx with no resolvable target into unallocated", () => {
    const txs: ProfitTxInput[] = [
      { type: "income", amount: 999 }, // farm overhead — no animalId / animalIds / campId
    ];
    const { byCamp, unallocated } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.size).toBe(0);
    expect(unallocated).toBe(999);
  });

  it("buckets a tx whose animalId is not in the roster map into unallocated", () => {
    const txs: ProfitTxInput[] = [
      { type: "income", amount: 700, animalId: "GHOST" },
    ];
    const { byCamp, unallocated } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.size).toBe(0);
    expect(unallocated).toBe(700);
  });

  it("buckets the share of any batch member missing from the roster into unallocated", () => {
    // A1 resolves (camp-1); GHOST does not. R1000 split = R500 each.
    const txs: ProfitTxInput[] = [
      { type: "income", amount: 1000, animalIds: JSON.stringify(["A1", "GHOST"]) },
    ];
    const { byCamp, unallocated } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.get("camp-1")).toBe(500);
    expect(unallocated).toBe(500);
  });

  it("falls back to unallocated when animalIds is malformed JSON (defensive parse)", () => {
    const txs: ProfitTxInput[] = [
      { type: "income", amount: 333, animalIds: "{not json" },
    ];
    const { byCamp, unallocated } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.size).toBe(0);
    expect(unallocated).toBe(333);
  });

  it("prefers animalId over animalIds over campId precedence is single-animal first", () => {
    // Single animalId present -> use last-camp rule, ignore campId.
    const txs: ProfitTxInput[] = [
      { type: "income", amount: 2000, animalId: "A2", campId: "camp-9" },
    ];
    const { byCamp } = attributeAmountsToCamps(txs, ANIMAL_CAMP);
    expect(byCamp.get("camp-2")).toBe(2000);
    expect(byCamp.get("camp-9")).toBeUndefined();
  });
});

// ── rollUpProfitByCamp — combine income/cost/LSU/ha into rows ─────────────────

const LSU_VALUES: Record<string, number> = { Cow: 1.0, Calf: 0.25 };

function baseInput(): ProfitPerCampRollupInput {
  return {
    incomeTxs: [],
    expenseTxs: [],
    animalLastCamp: { A1: "camp-1", A2: "camp-2" },
    camps: [
      { campId: "camp-1", campName: "North", sizeHectares: 10 },
      { campId: "camp-2", campName: "South", sizeHectares: null },
    ],
    activeAnimalsByCamp: {
      "camp-1": [{ category: "Cow" }, { category: "Calf" }], // LSU 1.25
      "camp-2": [], // LSU 0
    },
    lsuValues: LSU_VALUES,
  };
}

describe("rollUpProfitByCamp", () => {
  it("computes profit = income − cost per camp", () => {
    const input = baseInput();
    input.incomeTxs = [{ type: "income", amount: 5000, animalId: "A1" }];
    input.expenseTxs = [{ type: "expense", amount: 1000, campId: "camp-1" }];
    const { rows } = rollUpProfitByCamp(input);
    const c1 = rows.find((r) => r.campId === "camp-1")!;
    expect(c1.income).toBe(5000);
    expect(c1.cost).toBe(1000);
    expect(c1.profit).toBe(4000);
  });

  it("computes profitPerLsu with campLSU > 0", () => {
    const input = baseInput();
    input.incomeTxs = [{ type: "income", amount: 5000, animalId: "A1" }];
    // camp-1 LSU = 1.0 + 0.25 = 1.25 -> profit 5000 / 1.25 = 4000
    const { rows } = rollUpProfitByCamp(input);
    const c1 = rows.find((r) => r.campId === "camp-1")!;
    expect(c1.lsu).toBeCloseTo(1.25);
    expect(c1.profitPerLsu).toBeCloseTo(4000);
  });

  it("returns null profitPerLsu when campLSU = 0", () => {
    const input = baseInput();
    input.incomeTxs = [{ type: "income", amount: 3000, animalId: "A2" }]; // camp-2, LSU 0
    const { rows } = rollUpProfitByCamp(input);
    const c2 = rows.find((r) => r.campId === "camp-2")!;
    expect(c2.lsu).toBe(0);
    expect(c2.profitPerLsu).toBeNull();
  });

  it("computes profitPerHa with sizeHectares > 0", () => {
    const input = baseInput();
    input.incomeTxs = [{ type: "income", amount: 5000, animalId: "A1" }]; // camp-1, 10ha
    const { rows } = rollUpProfitByCamp(input);
    const c1 = rows.find((r) => r.campId === "camp-1")!;
    expect(c1.hectares).toBe(10);
    expect(c1.profitPerHa).toBeCloseTo(500);
  });

  it("returns null profitPerHa when sizeHectares is null", () => {
    const input = baseInput();
    input.incomeTxs = [{ type: "income", amount: 3000, animalId: "A2" }]; // camp-2, no ha
    const { rows } = rollUpProfitByCamp(input);
    const c2 = rows.find((r) => r.campId === "camp-2")!;
    expect(c2.hectares).toBeNull();
    expect(c2.profitPerHa).toBeNull();
  });

  it("returns null profitPerHa when sizeHectares is 0", () => {
    const input = baseInput();
    input.camps = [{ campId: "camp-1", campName: "North", sizeHectares: 0 }];
    input.incomeTxs = [{ type: "income", amount: 5000, animalId: "A1" }];
    const { rows } = rollUpProfitByCamp(input);
    const c1 = rows.find((r) => r.campId === "camp-1")!;
    expect(c1.profitPerHa).toBeNull();
  });

  it("sorts rows by profit descending", () => {
    const input = baseInput();
    input.incomeTxs = [
      { type: "income", amount: 2000, animalId: "A1" }, // camp-1
      { type: "income", amount: 9000, animalId: "A2" }, // camp-2
    ];
    const { rows } = rollUpProfitByCamp(input);
    expect(rows[0].campId).toBe("camp-2");
    expect(rows[1].campId).toBe("camp-1");
  });

  it("never spreads unallocated across camps and reports it separately", () => {
    const input = baseInput();
    input.incomeTxs = [
      { type: "income", amount: 5000, animalId: "A1" }, // camp-1
      { type: "income", amount: 1500 }, // overhead -> unallocated
    ];
    input.expenseTxs = [
      { type: "expense", amount: 400 }, // overhead -> unallocated
    ];
    const { rows, unallocated } = rollUpProfitByCamp(input);
    // unallocated income/cost never touch any camp
    const totalCampIncome = rows.reduce((s, r) => s + r.income, 0);
    expect(totalCampIncome).toBe(5000);
    expect(unallocated.income).toBe(1500);
    expect(unallocated.cost).toBe(400);
    expect(unallocated.net).toBe(1100);
  });

  it("uses campName from the camps list, falling back to campId", () => {
    const input = baseInput();
    input.incomeTxs = [{ type: "income", amount: 100, campId: "camp-unknown" }];
    const { rows } = rollUpProfitByCamp(input);
    const ck = rows.find((r) => r.campId === "camp-unknown")!;
    expect(ck.campName).toBe("camp-unknown"); // no metadata -> fall back to id
  });
});
