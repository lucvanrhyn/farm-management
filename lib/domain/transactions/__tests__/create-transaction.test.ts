/**
 * @vitest-environment node
 *
 * Wave D (#159) — domain op: `createTransaction`.
 *
 * Persists a transaction row after enforcing the saleType allowlist
 * (auction | private) and parsing numeric fields. Required-field shape
 * is enforced at the route layer via the schema parser; the op trusts
 * the body has `type`, `category`, `amount`, `date` set.
 *
 * Wire shape preserved: returns the raw Prisma `Transaction` row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { createTransaction } from "../create-transaction";
import { InvalidSaleTypeError } from "../errors";

describe("createTransaction(prisma, input)", () => {
  const create = vi.fn();
  const prisma = {
    transaction: { create },
  } as unknown as PrismaClient;

  beforeEach(() => {
    create.mockReset();
  });

  it("throws InvalidSaleTypeError when saleType is not auction|private", async () => {
    await expect(
      createTransaction(prisma, {
        type: "income",
        category: "Animal Sales",
        amount: 1000,
        date: "2026-05-01",
        saleType: "negotiated",
        createdBy: "u@x.co.za",
      }),
    ).rejects.toBeInstanceOf(InvalidSaleTypeError);
    expect(create).not.toHaveBeenCalled();
  });

  it("persists the row with parsed numerics and defaults", async () => {
    create.mockResolvedValue({ id: "tx-1" });

    const result = await createTransaction(prisma, {
      type: "income",
      category: "Animal Sales",
      amount: "1500.50",
      date: "2026-05-01",
      description: "Sale of weaners",
      animalId: "BR-001",
      campId: "NORTH-01",
      reference: "INV-42",
      saleType: "auction",
      counterparty: "Karoo Auction Co",
      quantity: "12",
      avgMassKg: "245.5",
      fees: "120",
      transportCost: "300",
      animalIds: JSON.stringify(["BR-001", "BR-002"]),
      isForeign: true,
      createdBy: "u@x.co.za",
    });

    expect(result).toEqual({ id: "tx-1" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        type: "income",
        category: "Animal Sales",
        amount: 1500.5,
        date: "2026-05-01",
        description: "Sale of weaners",
        animalId: "BR-001",
        campId: "NORTH-01",
        reference: "INV-42",
        createdBy: "u@x.co.za",
        saleType: "auction",
        counterparty: "Karoo Auction Co",
        quantity: 12,
        avgMassKg: 245.5,
        fees: 120,
        transportCost: 300,
        animalIds: JSON.stringify(["BR-001", "BR-002"]),
        isForeign: true,
      },
    });
  });

  it("defaults isForeign to false when omitted", async () => {
    create.mockResolvedValue({ id: "tx-2" });

    await createTransaction(prisma, {
      type: "expense",
      category: "Feed/Supplements",
      amount: 200,
      date: "2026-06-01",
      createdBy: null,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isForeign: false }),
    });
  });

  it("persists isForeign=true when explicitly set", async () => {
    create.mockResolvedValue({ id: "tx-3" });

    await createTransaction(prisma, {
      type: "income",
      category: "Animal Sales",
      amount: 500,
      date: "2026-07-15",
      isForeign: true,
      createdBy: "u@x.co.za",
    });

    expect(create.mock.calls[0][0].data.isForeign).toBe(true);
  });

  it("persists isForeign=false when explicitly false", async () => {
    create.mockResolvedValue({ id: "tx-4" });

    await createTransaction(prisma, {
      type: "expense",
      category: "Labour",
      amount: 100,
      date: "2026-06-01",
      isForeign: false,
      createdBy: "u@x.co.za",
    });

    expect(create.mock.calls[0][0].data.isForeign).toBe(false);
  });

  it("nulls optional fields when omitted (description default empty string)", async () => {
    create.mockResolvedValue({ id: "tx-5" });

    await createTransaction(prisma, {
      type: "expense",
      category: "Diesel",
      amount: 800,
      date: "2026-04-01",
      createdBy: "u@x.co.za",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        type: "expense",
        category: "Diesel",
        amount: 800,
        date: "2026-04-01",
        description: "",
        animalId: null,
        campId: null,
        reference: null,
        createdBy: "u@x.co.za",
        saleType: null,
        counterparty: null,
        quantity: null,
        avgMassKg: null,
        fees: null,
        transportCost: null,
        animalIds: null,
        isForeign: false,
      },
    });
  });

  it("accepts numeric amount/quantity/etc. directly without re-parsing", async () => {
    create.mockResolvedValue({ id: "tx-6" });

    await createTransaction(prisma, {
      type: "income",
      category: "Animal Sales",
      amount: 1234.5,
      date: "2026-05-01",
      quantity: 7,
      avgMassKg: 250,
      fees: 50,
      transportCost: 100,
      saleType: "private",
      createdBy: "u@x.co.za",
    });

    const data = create.mock.calls[0][0].data;
    expect(data.amount).toBe(1234.5);
    expect(data.quantity).toBe(7);
    expect(data.avgMassKg).toBe(250);
    expect(data.fees).toBe(50);
    expect(data.transportCost).toBe(100);
    expect(data.saleType).toBe("private");
  });
});
