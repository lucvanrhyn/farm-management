/**
 * Wave D (#159) — domain op `resetTransactions`.
 *
 * Bulk-deletes every transaction AND every transactionCategory row for
 * the calling tenant. The route adapter (`adminWrite`) gates this on a
 * fresh-ADMIN check; the op itself is dependency-free against the
 * Prisma scope handed in.
 *
 * Note: TransactionCategory mass-delete stays here even though
 * categories are otherwise Wave-D2 scope — the pre-Wave-D route did
 * both atomically, and the admin "Reset all finances" UI expects that
 * semantics. Splitting would surprise the operator.
 *
 * Wire shape `{ success: true }` is preserved verbatim from the legacy
 * route handler.
 */
import type { PrismaClient } from "@prisma/client";

export interface ResetTransactionsResult {
  success: true;
}

export async function resetTransactions(
  prisma: PrismaClient,
): Promise<ResetTransactionsResult> {
  await prisma.transaction.deleteMany({});
  await prisma.transactionCategory.deleteMany({});
  return { success: true };
}
