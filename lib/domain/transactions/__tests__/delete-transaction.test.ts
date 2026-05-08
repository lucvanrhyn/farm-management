/**
 * @vitest-environment node
 *
 * Wave D (#159) — domain op: `deleteTransaction`.
 *
 * Removes a transaction row by id. Pre-checks existence with
 * `findUnique` (matches the pre-Wave-D DELETE route's contract) and
 * throws `TransactionNotFoundError` so the adapter envelope mints a 404
 * `{ error: "TRANSACTION_NOT_FOUND" }`.
 *
 * Returns `{ ok: true }` (preserved verbatim — admin /finansies UI +
 * offline-sync queue compare against this exact shape).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { deleteTransaction } from "../delete-transaction";
import { TransactionNotFoundError } from "../errors";

describe("deleteTransaction(prisma, id)", () => {
  const findUnique = vi.fn();
  const del = vi.fn();
  const prisma = {
    transaction: { findUnique, delete: del },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findUnique.mockReset();
    del.mockReset();
  });

  it("throws TransactionNotFoundError when the row does not exist", async () => {
    findUnique.mockResolvedValue(null);

    await expect(deleteTransaction(prisma, "missing")).rejects.toBeInstanceOf(
      TransactionNotFoundError,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes the row and returns { ok: true } when it exists", async () => {
    findUnique.mockResolvedValue({ id: "tx-1" });
    del.mockResolvedValue({ id: "tx-1" });

    const result = await deleteTransaction(prisma, "tx-1");

    expect(result).toEqual({ ok: true });
    expect(del).toHaveBeenCalledWith({ where: { id: "tx-1" } });
  });
});
