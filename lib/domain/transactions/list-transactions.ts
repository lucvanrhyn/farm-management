/**
 * Wave D (#159) — domain op `listTransactions`.
 *
 * Returns transaction rows for the calling tenant. The route adapter
 * supplies a tenant-scoped Prisma client; this op layers filter
 * translation and the date-range precondition on top.
 *
 * Date filter contract:
 *   - `from` / `to`, when present, must match `YYYY-MM-DD`. Any other
 *     shape throws `InvalidDateFormatError` (legacy `400 "from must be
 *     YYYY-MM-DD"` migrated to a typed code per ADR-0001).
 *   - The Prisma row's `date` column is itself a `YYYY-MM-DD` string,
 *     so the filter compares string-vs-string with `gte` / `lte`.
 *
 * Wire shape stays the raw Prisma `Transaction` row — preserved verbatim
 * so the admin /finansies UI and offline-sync queue remain compatible.
 */
import type { PrismaClient, Transaction } from "@prisma/client";

import { InvalidDateFormatError } from "./errors";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ListTransactionsFilters {
  type?: string | null;
  category?: string | null;
  from?: string | null;
  to?: string | null;
}

export async function listTransactions(
  prisma: PrismaClient,
  filters: ListTransactionsFilters,
): Promise<Transaction[]> {
  if (filters.from && !DATE_RE.test(filters.from)) {
    throw new InvalidDateFormatError("from", filters.from);
  }
  if (filters.to && !DATE_RE.test(filters.to)) {
    throw new InvalidDateFormatError("to", filters.to);
  }

  const where: Record<string, unknown> = {};
  if (filters.type) where.type = filters.type;
  if (filters.category) where.category = filters.category;
  if (filters.from || filters.to) {
    const dateFilter: Record<string, string> = {};
    if (filters.from) dateFilter.gte = filters.from;
    if (filters.to) dateFilter.lte = filters.to;
    where.date = dateFilter;
  }

  return prisma.transaction.findMany({
    where,
    orderBy: { date: "desc" },
  });
}
