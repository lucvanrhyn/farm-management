/**
 * Wave D (#159) — domain op `createTransaction`.
 *
 * Persists a new transaction row. Required-shape validation
 * (`type`, `category`, `amount`, `date`) is enforced at the route layer
 * via the schema parser, mirroring Wave C's precedent — the op trusts
 * those four are present and treats only business-rule violations
 * (saleType allowlist) as throwable here.
 *
 * Numeric fields accept either string or number on input — legacy
 * offline-sync clients still send strings — and are coerced to floats /
 * ints before persistence.
 *
 * `isForeign` defaults to `false` when omitted (SARS source code
 * 0192/0193 driver — see wave/26e tests).
 */
import type { PrismaClient, Transaction } from "@prisma/client";

import { InvalidSaleTypeError, VALID_SALE_TYPES } from "./errors";

export interface CreateTransactionInput {
  type: string;
  category: string;
  amount: number | string;
  date: string;
  description?: string | null;
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
  isForeign?: boolean | null;
  /** Email of the actor — captured on the audit trail. */
  createdBy: string | null;
}

function toFloat(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : parseFloat(v);
}

function toInt(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : parseInt(v, 10);
}

export async function createTransaction(
  prisma: PrismaClient,
  input: CreateTransactionInput,
): Promise<Transaction> {
  if (
    input.saleType != null &&
    !VALID_SALE_TYPES.includes(input.saleType as (typeof VALID_SALE_TYPES)[number])
  ) {
    throw new InvalidSaleTypeError(input.saleType);
  }

  return prisma.transaction.create({
    data: {
      type: input.type,
      category: input.category,
      amount: toFloat(input.amount) ?? 0,
      date: input.date,
      description: input.description ?? "",
      animalId: input.animalId ?? null,
      campId: input.campId ?? null,
      reference: input.reference ?? null,
      createdBy: input.createdBy,
      saleType: input.saleType ?? null,
      counterparty: input.counterparty ?? null,
      quantity: toInt(input.quantity),
      avgMassKg: toFloat(input.avgMassKg),
      fees: toFloat(input.fees),
      transportCost: toFloat(input.transportCost),
      animalIds: input.animalIds ?? null,
      isForeign: input.isForeign === true,
    },
  });
}
