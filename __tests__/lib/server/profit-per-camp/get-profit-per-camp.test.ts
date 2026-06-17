// @vitest-environment node
/**
 * __tests__/lib/server/profit-per-camp/get-profit-per-camp.test.ts
 *
 * getProfitPerCamp() wires three reads (transactions, camps, animals) into the
 * pure profit-per-camp calculator. crossSpecies() forwards model.findMany(args)
 * verbatim to the underlying client (see lib/server/species-scoped-prisma.ts),
 * so a single fake prisma with spied delegates captures every query shape.
 */
import { describe, it, expect, vi } from "vitest";
import { getProfitPerCamp } from "@/lib/server/profit-per-camp/get-profit-per-camp";
import type { PrismaClient } from "@prisma/client";

interface FakeRows {
  transactions?: unknown[];
  camps?: unknown[];
  animals?: unknown[];
}

function fakePrisma(rows: FakeRows) {
  const txFindMany = vi.fn().mockResolvedValue(rows.transactions ?? []);
  const campFindMany = vi.fn().mockResolvedValue(rows.camps ?? []);
  // Status-aware: honour the query's `where.status.in` filter so a too-narrow
  // predicate genuinely drops animals from the result (mirrors the real DB).
  // Without this the fake would return excluded animals and hide the bug.
  const animalFindMany = vi.fn().mockImplementation((args?: { where?: { status?: { in?: string[] } } }) => {
    const statusIn = args?.where?.status?.in;
    const all = (rows.animals ?? []) as Array<{ status?: string }>;
    const filtered = Array.isArray(statusIn)
      ? all.filter((a) => typeof a.status === "string" && statusIn.includes(a.status))
      : all;
    return Promise.resolve(filtered);
  });
  const prisma = {
    transaction: { findMany: txFindMany },
    camp: { findMany: campFindMany },
    animal: { findMany: animalFindMany },
  } as unknown as PrismaClient;
  return { prisma, txFindMany, campFindMany, animalFindMany };
}

describe("getProfitPerCamp — read wiring", () => {
  it("reads income + expense transactions over the date STRING range", async () => {
    const { prisma, txFindMany } = fakePrisma({});
    await getProfitPerCamp(prisma, "trio-b", { from: "2026-01-01", to: "2026-06-30" });

    const where = txFindMany.mock.calls.at(-1)?.[0]?.where as Record<string, unknown>;
    expect(where.date).toEqual({ gte: "2026-01-01", lte: "2026-06-30" });
    // Both income and expense must be in scope (no type predicate, or an OR over both).
    expect(where.type).toBeUndefined();
  });

  it("queries animals with a literal status:{in:[...]} predicate that includes deceased/culled for income attribution", async () => {
    const { prisma, animalFindMany } = fakePrisma({});
    await getProfitPerCamp(prisma, "trio-b");

    const where = animalFindMany.mock.calls.at(-1)?.[0]?.where as Record<string, unknown>;
    // All four real statuses: Active drives LSU; Sold/Deceased/Culled carry
    // income (sale, slaughter/mortality, cull-for-meat) and their last camp.
    expect(where.status).toEqual({ in: ["Active", "Sold", "Deceased", "Culled"] });
  });

  it("attributes a single-animal sale to the sold animal's last camp", async () => {
    const { prisma } = fakePrisma({
      transactions: [
        { type: "income", amount: 5000, animalId: "A1", animalIds: null, campId: null },
      ],
      camps: [{ campId: "camp-1", campName: "North", sizeHectares: 10 }],
      animals: [
        { animalId: "A1", category: "Cow", currentCamp: "camp-1", status: "Sold" },
      ],
    });
    const { rows } = await getProfitPerCamp(prisma, "trio-b");
    const c1 = rows.find((r) => r.campId === "camp-1")!;
    expect(c1.income).toBe(5000);
    expect(c1.profit).toBe(5000);
  });

  it("uses only ACTIVE animals for the LSU denominator (Sold excluded)", async () => {
    const { prisma } = fakePrisma({
      transactions: [
        { type: "income", amount: 2000, animalId: "SOLD1", animalIds: null, campId: null },
      ],
      camps: [{ campId: "camp-1", campName: "North", sizeHectares: 10 }],
      animals: [
        // Active cow drives the LSU; the sold animal carries the income.
        { animalId: "ACT1", category: "Cow", currentCamp: "camp-1", status: "Active" },
        { animalId: "SOLD1", category: "Cow", currentCamp: "camp-1", status: "Sold" },
      ],
    });
    const { rows } = await getProfitPerCamp(prisma, "trio-b");
    const c1 = rows.find((r) => r.campId === "camp-1")!;
    // Only 1 active Cow -> LSU 1.0 -> profitPerLsu = 2000 / 1.0 = 2000
    expect(c1.lsu).toBeCloseTo(1.0);
    expect(c1.profitPerLsu).toBeCloseTo(2000);
  });

  it("attributes a DECEASED animal's income (slaughter/mortality) to its last camp, not unallocated", async () => {
    const { prisma } = fakePrisma({
      transactions: [
        { type: "income", amount: 8000, animalId: "DEC1", animalIds: null, campId: null },
      ],
      camps: [{ campId: "camp-1", campName: "North", sizeHectares: 10 }],
      animals: [
        { animalId: "DEC1", category: "Cow", currentCamp: "camp-1", status: "Deceased" },
      ],
    });
    const { rows, unallocated } = await getProfitPerCamp(prisma, "trio-b");
    const c1 = rows.find((r) => r.campId === "camp-1")!;
    expect(c1.income).toBe(8000);
    expect(unallocated.income).toBe(0);
  });

  it("attributes a CULLED animal's income (cull-for-meat) to its last camp, not unallocated", async () => {
    const { prisma } = fakePrisma({
      transactions: [
        { type: "income", amount: 3500, animalId: "CUL1", animalIds: null, campId: null },
      ],
      camps: [{ campId: "camp-1", campName: "North", sizeHectares: 10 }],
      animals: [
        { animalId: "CUL1", category: "Cow", currentCamp: "camp-1", status: "Culled" },
      ],
    });
    const { rows, unallocated } = await getProfitPerCamp(prisma, "trio-b");
    const c1 = rows.find((r) => r.campId === "camp-1")!;
    expect(c1.income).toBe(3500);
    expect(unallocated.income).toBe(0);
  });

  it("keeps the LSU denominator ACTIVE-only — deceased/culled animals attribute income but never inflate LSU", async () => {
    const { prisma } = fakePrisma({
      transactions: [
        { type: "income", amount: 2000, animalId: "DEC1", animalIds: null, campId: null },
      ],
      camps: [{ campId: "camp-1", campName: "North", sizeHectares: 10 }],
      animals: [
        { animalId: "ACT1", category: "Cow", currentCamp: "camp-1", status: "Active" },
        { animalId: "DEC1", category: "Cow", currentCamp: "camp-1", status: "Deceased" },
      ],
    });
    const { rows } = await getProfitPerCamp(prisma, "trio-b");
    const c1 = rows.find((r) => r.campId === "camp-1")!;
    // Income from the deceased cow attributes here, but only the 1 active cow
    // counts toward LSU -> profitPerLsu = 2000 / 1.0, NOT 2000 / 2.0.
    expect(c1.lsu).toBeCloseTo(1.0);
    expect(c1.profitPerLsu).toBeCloseTo(2000);
  });

  it("reports overhead with no animalId/campId as a separate unallocated line", async () => {
    const { prisma } = fakePrisma({
      transactions: [
        { type: "income", amount: 1000, animalId: "A1", animalIds: null, campId: null },
        { type: "expense", amount: 300, animalId: null, animalIds: null, campId: null },
      ],
      camps: [{ campId: "camp-1", campName: "North", sizeHectares: null }],
      animals: [
        { animalId: "A1", category: "Cow", currentCamp: "camp-1", status: "Sold" },
      ],
    });
    const { rows, unallocated } = await getProfitPerCamp(prisma, "trio-b");
    expect(rows.reduce((s, r) => s + r.cost, 0)).toBe(0);
    expect(unallocated.cost).toBe(300);
    expect(unallocated.income).toBe(0);
  });

  it("returns empty rows + zero unallocated when there is no data", async () => {
    const { prisma } = fakePrisma({});
    const { rows, unallocated } = await getProfitPerCamp(prisma, "trio-b");
    expect(rows).toEqual([]);
    expect(unallocated).toEqual({ income: 0, cost: 0, net: 0 });
  });
});
