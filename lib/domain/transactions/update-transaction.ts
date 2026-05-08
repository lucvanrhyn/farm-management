/**
 * Wave D (#159) — domain op `updateTransaction`.
 *
 * Partially updates a transaction row. Only fields explicitly present in
 * the input land in the Prisma `data` payload — preserves the
 * pre-Wave-D PATCH semantics that the wave/26e
 * `transaction-is-foreign` test pins (`expect(data.isForeign).toBeUndefined()`
 * when the field is omitted).
 *
 * Throws `InvalidSaleTypeError` when `saleType` is set to a value
 * outside the allowlist. Rethrows Prisma's P2025 record-not-found as
 * `TransactionNotFoundError` so the route adapter envelope mints a 404
 * `{ error: "TRANSACTION_NOT_FOUND" }`.
 */
import type { PrismaClient, Transaction } from "@prisma/client";

import {
  InvalidSaleTypeError,
  TransactionNotFoundError,
  VALID_SALE_TYPES,
} from "./errors";

export interface UpdateTransactionInput {
  type?: string;
  category?: string;
  amount?: number | string;
  date?: string;
  description?: string;
  animalId?: string | null;
  campId?: string | null;
  reference?: string | null;
  saleType?: string | null;
  counterparty?: string | null;
  quantity?: number | string | null;
  avgMassKg?: number | string | null;
  fees?: number | string | null;
  transportCost?: number | string | null;
  animalIds?: string | null;
  isForeign?: boolean;
}

function toFloat(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : parseFloat(v);
}

function toInt(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : parseInt(v, 10);
}

export async function updateTransaction(
  prisma: PrismaClient,
  id: string,
  input: UpdateTransactionInput,
): Promise<Transaction> {
  if (
    input.saleType != null &&
    !VALID_SALE_TYPES.includes(input.saleType as (typeof VALID_SALE_TYPES)[number])
  ) {
    throw new InvalidSaleTypeError(input.saleType);
  }

  const data: Record<string, unknown> = {};
  if (input.type !== undefined) data.type = input.type;
  if (input.category !== undefined) data.category = input.category;
  if (input.amount !== undefined) {
    data.amount = typeof input.amount === "number" ? input.amount : parseFloat(input.amount);
  }
  if (input.date !== undefined) data.date = input.date;
  if (input.description !== undefined) data.description = input.description;
  if (input.animalId !== undefined) data.animalId = input.animalId;
  if (input.campId !== undefined) data.campId = input.campId;
  if (input.reference !== undefined) data.reference = input.reference;
  if (input.saleType !== undefined) data.saleType = input.saleType ?? null;
  if (input.counterparty !== undefined) data.counterparty = input.counterparty ?? null;
  if (input.quantity !== undefined) data.quantity = toInt(input.quantity);
  if (input.avgMassKg !== undefined) data.avgMassKg = toFloat(input.avgMassKg);
  if (input.fees !== undefined) data.fees = toFloat(input.fees);
  if (input.transportCost !== undefined) data.transportCost = toFloat(input.transportCost);
  if (input.animalIds !== undefined) data.animalIds = input.animalIds ?? null;
  if (input.isForeign !== undefined) data.isForeign = input.isForeign === true;

  try {
    return await prisma.transaction.update({
      where: { id },
      data,
    });
  } catch (err) {
    // Prisma's P2025 indicates the row to update did not exist.
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2025") {
      throw new TransactionNotFoundError(id);
    }
    throw err;
  }
}
