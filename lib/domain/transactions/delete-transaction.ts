/**
 * Wave D (#159) — domain op `deleteTransaction`.
 *
 * Removes a transaction row by id after a `findUnique` existence pre-check
 * (matches the pre-Wave-D DELETE route's contract). Throws
 * `TransactionNotFoundError` when the row does not exist so the adapter
 * envelope mints a 404 `{ error: "TRANSACTION_NOT_FOUND" }`.
 *
 * Returns `{ ok: true }` — preserved verbatim from the legacy wire
 * shape so admin /finansies UI + offline-sync queue stay compatible.
 */
import type { PrismaClient } from "@prisma/client";

import { TransactionNotFoundError } from "./errors";

export interface DeleteTransactionResult {
  ok: true;
}

export async function deleteTransaction(
  prisma: PrismaClient,
  id: string,
): Promise<DeleteTransactionResult> {
  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing) {
    throw new TransactionNotFoundError(id);
  }

  await prisma.transaction.delete({ where: { id } });

  return { ok: true };
}
