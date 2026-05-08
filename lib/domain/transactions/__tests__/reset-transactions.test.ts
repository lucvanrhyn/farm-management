/**
 * @vitest-environment node
 *
 * Wave D (#159) — domain op: `resetTransactions`.
 *
 * Bulk-deletes every transaction AND transactionCategory row for the
 * calling tenant in one atomic op. The `transactionCategory` mass-delete
 * stays here even though categories are otherwise Wave-D2 scope — the
 * legacy DELETE /api/transactions/reset route did both, and consumers
 * (admin "Reset all finances" UI) expect the atomic semantics.
 *
 * Wire shape `{ success: true }` is preserved verbatim.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { resetTransactions } from "../reset-transactions";

describe("resetTransactions(prisma)", () => {
  it("deletes every transaction AND every transactionCategory row", async () => {
    const transactionDeleteMany = vi.fn().mockResolvedValue({ count: 13 });
    const transactionCategoryDeleteMany = vi.fn().mockResolvedValue({ count: 4 });
    const prisma = {
      transaction: { deleteMany: transactionDeleteMany },
      transactionCategory: { deleteMany: transactionCategoryDeleteMany },
    } as unknown as PrismaClient;

    const result = await resetTransactions(prisma);

    expect(transactionDeleteMany).toHaveBeenCalledWith({});
    expect(transactionCategoryDeleteMany).toHaveBeenCalledWith({});
    expect(result).toEqual({ success: true });
  });

  it("succeeds when both tables are already empty", async () => {
    const transactionDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const transactionCategoryDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      transaction: { deleteMany: transactionDeleteMany },
      transactionCategory: { deleteMany: transactionCategoryDeleteMany },
    } as unknown as PrismaClient;

    const result = await resetTransactions(prisma);

    expect(result).toEqual({ success: true });
  });
});
