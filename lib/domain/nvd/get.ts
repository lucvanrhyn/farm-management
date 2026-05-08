/**
 * Wave G1 (#165) — domain ops `getNvdById`, `getNvdByIdOrThrow`,
 * `listNvds`.
 *
 * Lifts the inline `prisma.nvdRecord.findUnique` / `findMany` calls out of
 * the route handlers. The list query preserves the explicit `select` (so
 * `audit-findmany-no-select` stays clean) and computes `headCount` from
 * the JSON-stringified `animalIds` column without parsing the full
 * `animalSnapshot`.
 *
 * `getNvdByIdOrThrow` throws `NvdNotFoundError` so the adapter envelope
 * mints 404 NVD_NOT_FOUND. `getNvdById` returns null for callers (PDF
 * route, exporters) that need to inspect whether the record exists
 * without raising.
 */
import type { PrismaClient } from "@prisma/client";

import { NvdNotFoundError } from "./errors";

const LIST_LIMIT = 20;

/** Single-record select used by route detail + PDF. Returns the full
 * row — the snapshot fields are needed by the PDF builder. */
export async function getNvdById(
  prisma: PrismaClient,
  id: string,
): Promise<Awaited<ReturnType<PrismaClient["nvdRecord"]["findUnique"]>>> {
  return prisma.nvdRecord.findUnique({ where: { id } });
}

/** Throwing variant — used by routes whose 404 path is wired into
 * `mapApiDomainError`. */
export async function getNvdByIdOrThrow(
  prisma: PrismaClient,
  id: string,
): Promise<NonNullable<Awaited<ReturnType<typeof getNvdById>>>> {
  const record = await getNvdById(prisma, id);
  if (!record) {
    throw new NvdNotFoundError(id);
  }
  return record;
}

export interface ListNvdsArgs {
  /** 1-based page number — clamped to >= 1. */
  page?: number;
}

export interface ListNvdsResult {
  records: Array<{
    id: string;
    nvdNumber: string;
    issuedAt: Date;
    saleDate: string;
    buyerName: string;
    animalIds: string;
    generatedBy: string | null;
    voidedAt: Date | null;
    voidReason: string | null;
    transactionId: string | null;
    headCount: number;
  }>;
  total: number;
  page: number;
  limit: number;
}

/**
 * Paginated list of NVDs — page size fixed at 20 (matches pre-G1 wire).
 *
 * Computes `headCount` from the JSON-stringified `animalIds` column to
 * avoid materialising the full animal snapshot.
 */
export async function listNvds(
  prisma: PrismaClient,
  args: ListNvdsArgs = {},
): Promise<ListNvdsResult> {
  const page = Math.max(1, args.page ?? 1);
  const limit = LIST_LIMIT;
  const skip = (page - 1) * limit;

  const [records, total] = await Promise.all([
    prisma.nvdRecord.findMany({
      orderBy: { issuedAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        nvdNumber: true,
        issuedAt: true,
        saleDate: true,
        buyerName: true,
        animalIds: true,
        generatedBy: true,
        voidedAt: true,
        voidReason: true,
        transactionId: true,
      },
    }),
    prisma.nvdRecord.count(),
  ]);

  const withCount = records.map((r) => {
    let headCount = 0;
    try {
      headCount = (JSON.parse(r.animalIds) as string[]).length;
    } catch {
      headCount = 0;
    }
    return { ...r, headCount };
  });

  return { records: withCount, total, page, limit };
}
