/**
 * @vitest-environment node
 *
 * Wave D (#159) — domain op: `updateTransaction`.
 *
 * Partially updates a transaction row. Only fields explicitly present in
 * the input are written (preserves the existing `if (foo !== undefined)`
 * semantics from the pre-Wave-D PATCH route — critical for the
 * `transaction-is-foreign` PATCH contract that expects untouched fields
 * to remain undefined in the Prisma data payload).
 *
 * Throws `InvalidSaleTypeError` on bad saleType. Throws
 * `TransactionNotFoundError` when Prisma surfaces a P2025
 * record-not-found error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { updateTransaction } from "../update-transaction";
import {
  InvalidSaleTypeError,
  TransactionNotFoundError,
} from "../errors";

describe("updateTransaction(prisma, id, input)", () => {
  const update = vi.fn();
  const prisma = {
    transaction: { update },
  } as unknown as PrismaClient;

  beforeEach(() => {
    update.mockReset();
  });

  it("throws InvalidSaleTypeError when saleType is not auction|private", async () => {
    await expect(
      updateTransaction(prisma, "tx-1", { saleType: "barter" }),
    ).rejects.toBeInstanceOf(InvalidSaleTypeError);
    expect(update).not.toHaveBeenCalled();
  });

  it("partial-updates only the fields explicitly present in the input", async () => {
    update.mockResolvedValue({ id: "tx-1", description: "edited" });

    const result = await updateTransaction(prisma, "tx-1", {
      description: "edited",
    });

    expect(result).toEqual({ id: "tx-1", description: "edited" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "tx-1" },
      data: { description: "edited" },
    });
  });

  it("does not touch isForeign when omitted (wave/26e contract)", async () => {
    update.mockResolvedValue({ id: "tx-1" });

    await updateTransaction(prisma, "tx-1", { description: "edit only" });

    expect(update.mock.calls[0][0].data.isForeign).toBeUndefined();
  });

  it("persists isForeign=true when provided", async () => {
    update.mockResolvedValue({ id: "tx-1", isForeign: true });

    await updateTransaction(prisma, "tx-1", { isForeign: true });

    expect(update.mock.calls[0][0].data.isForeign).toBe(true);
  });

  it("persists isForeign=false when toggled off", async () => {
    update.mockResolvedValue({ id: "tx-1", isForeign: false });

    await updateTransaction(prisma, "tx-1", { isForeign: false });

    expect(update.mock.calls[0][0].data.isForeign).toBe(false);
  });

  it("parses numeric strings into floats/ints", async () => {
    update.mockResolvedValue({ id: "tx-1" });

    await updateTransaction(prisma, "tx-1", {
      amount: "1500.5",
      quantity: "12",
      avgMassKg: "245.5",
      fees: "120",
      transportCost: "300",
    });

    const data = update.mock.calls[0][0].data;
    expect(data.amount).toBe(1500.5);
    expect(data.quantity).toBe(12);
    expect(data.avgMassKg).toBe(245.5);
    expect(data.fees).toBe(120);
    expect(data.transportCost).toBe(300);
  });

  it("nulls saleType / counterparty / animalIds when explicitly null", async () => {
    update.mockResolvedValue({ id: "tx-1" });

    await updateTransaction(prisma, "tx-1", {
      saleType: null,
      counterparty: null,
      animalIds: null,
    });

    const data = update.mock.calls[0][0].data;
    expect(data.saleType).toBe(null);
    expect(data.counterparty).toBe(null);
    expect(data.animalIds).toBe(null);
  });

  it("throws TransactionNotFoundError on Prisma P2025", async () => {
    const p2025 = Object.assign(new Error("Record to update not found"), {
      code: "P2025",
    });
    update.mockRejectedValue(p2025);

    await expect(
      updateTransaction(prisma, "missing", { description: "x" }),
    ).rejects.toBeInstanceOf(TransactionNotFoundError);
  });

  it("rethrows non-P2025 Prisma errors unchanged", async () => {
    const other = Object.assign(new Error("DB connection lost"), {
      code: "P1001",
    });
    update.mockRejectedValue(other);

    await expect(
      updateTransaction(prisma, "tx-1", { description: "x" }),
    ).rejects.toBe(other);
  });

  it("propagates all field updates verbatim when explicitly set", async () => {
    update.mockResolvedValue({ id: "tx-1" });

    await updateTransaction(prisma, "tx-1", {
      type: "income",
      category: "Animal Sales",
      amount: 1000,
      date: "2026-05-01",
      description: "test",
      animalId: "BR-001",
      campId: "NORTH-01",
      reference: "INV-1",
      saleType: "private",
      counterparty: "John",
      quantity: 5,
      avgMassKg: 200,
      fees: 50,
      transportCost: 100,
      animalIds: "[]",
      isForeign: true,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "tx-1" },
      data: {
        type: "income",
        category: "Animal Sales",
        amount: 1000,
        date: "2026-05-01",
        description: "test",
        animalId: "BR-001",
        campId: "NORTH-01",
        reference: "INV-1",
        saleType: "private",
        counterparty: "John",
        quantity: 5,
        avgMassKg: 200,
        fees: 50,
        transportCost: 100,
        animalIds: "[]",
        isForeign: true,
      },
    });
  });
});
