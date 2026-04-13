/**
 * lib/server/sars-it3.ts
 *
 * Server-side aggregator for the SARS / IT3 farming tax export. Reads from a
 * PrismaClient (per-tenant) and freezes everything into an immutable snapshot
 * that is stored in It3Snapshot.payload as JSON.
 *
 * Snapshot immutability — once issued, the PDF / CSV re-renders read only from
 * the stored payload, so late edits to historical transactions cannot alter
 * a previously-filed return. Mirrors the NVD pattern in `lib/server/nvd.ts`.
 */

import type { PrismaClient } from "@prisma/client";
import {
  computeIt3Schedules,
  getSaTaxYearRange,
  IT3_SCHEDULE_MAP,
  type It3ScheduleTotals,
  type TransactionLike,
} from "@/lib/calculators/sars-it3";

// ── Snapshot shape ────────────────────────────────────────────────────────────

export interface FarmIdentitySnapshot {
  farmName: string;
  ownerName: string;
  ownerIdNumber: string;
  physicalAddress: string;
  postalAddress: string;
  contactPhone: string;
  contactEmail: string;
  propertyRegNumber: string;
  farmRegion: string;
}

export interface It3LivestockInventorySnapshot {
  activeAtPeriodEnd: number;
  byCategory: Array<{ category: string; count: number }>;
}

export interface It3SnapshotPayload {
  taxYear: number;
  periodStart: string;
  periodEnd: string;
  farm: FarmIdentitySnapshot;
  schedules: It3ScheduleTotals;
  inventory: It3LivestockInventorySnapshot;
  meta: {
    generatedAtIso: string;
    generatedBy: string | null;
    sourceTransactionCount: number;
    categoryMapVersion: string;
    mappedCategories: string[];
  };
}

// ── Payload builder ───────────────────────────────────────────────────────────

const CATEGORY_MAP_VERSION = "2026-04-14";

export async function buildFarmIdentitySnapshot(
  prisma: PrismaClient,
): Promise<FarmIdentitySnapshot> {
  const settings = await prisma.farmSettings.findFirst();
  return {
    farmName: settings?.farmName ?? "My Farm",
    ownerName: settings?.ownerName ?? "",
    ownerIdNumber: settings?.ownerIdNumber ?? "",
    physicalAddress: settings?.physicalAddress ?? "",
    postalAddress: settings?.postalAddress ?? "",
    contactPhone: settings?.contactPhone ?? "",
    contactEmail: settings?.contactEmail ?? "",
    propertyRegNumber: settings?.propertyRegNumber ?? "",
    farmRegion: settings?.farmRegion ?? "",
  };
}

async function buildInventorySnapshot(
  prisma: PrismaClient,
): Promise<It3LivestockInventorySnapshot> {
  // Active animals at the moment of issue. For V1 we do NOT attempt to
  // reconstruct historical stock-at-period-end — that would require replaying
  // every movement/sale observation across the year, which deserves its own
  // design pass. Farmers can compare against their own stock sheet.
  const grouped = await prisma.animal.groupBy({
    by: ["category"],
    where: { status: "Active" },
    _count: { id: true },
  });
  const byCategory = grouped
    .map((g) => ({ category: g.category, count: g._count.id }))
    .sort((a, b) => b.count - a.count);
  const activeAtPeriodEnd = byCategory.reduce((s, r) => s + r.count, 0);
  return { activeAtPeriodEnd, byCategory };
}

/**
 * Aggregate a tax-year IT3 payload for the given tax year (YYYY = calendar
 * year the SA Feb falls in). Does NOT persist anything — caller decides
 * whether to preview or commit.
 */
export async function getIt3Payload(
  prisma: PrismaClient,
  taxYear: number,
  generatedBy: string | null,
): Promise<It3SnapshotPayload> {
  const { start, end } = getSaTaxYearRange(taxYear);

  const [transactions, farm, inventory] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: { gte: start, lte: end } },
      select: {
        type: true,
        category: true,
        amount: true,
        date: true,
        description: true,
      },
    }),
    buildFarmIdentitySnapshot(prisma),
    buildInventorySnapshot(prisma),
  ]);

  const schedules = computeIt3Schedules(
    transactions as TransactionLike[],
    taxYear,
  );

  return {
    taxYear,
    periodStart: start,
    periodEnd: end,
    farm,
    schedules,
    inventory,
    meta: {
      generatedAtIso: new Date().toISOString(),
      generatedBy,
      sourceTransactionCount: transactions.length,
      categoryMapVersion: CATEGORY_MAP_VERSION,
      mappedCategories: Object.keys(IT3_SCHEDULE_MAP).sort(),
    },
  };
}

// ── Issue + void flows ────────────────────────────────────────────────────────

export interface It3IssueInput {
  taxYear: number;
  generatedBy: string | null;
}

/**
 * Issue an IT3 snapshot for a tax year. Blocks if there is already a
 * non-voided snapshot for the same year — the caller must void the existing
 * one first before re-issuing.
 */
export async function issueIt3Snapshot(
  prisma: PrismaClient,
  input: It3IssueInput,
): Promise<{ id: string; taxYear: number }> {
  const existing = await prisma.it3Snapshot.findFirst({
    where: { taxYear: input.taxYear, voidedAt: null },
    select: { id: true },
  });
  if (existing) {
    throw new Error(
      `An active IT3 snapshot already exists for tax year ${input.taxYear}. Void it before re-issuing.`,
    );
  }

  const payload = await getIt3Payload(prisma, input.taxYear, input.generatedBy);

  const record = await prisma.it3Snapshot.create({
    data: {
      taxYear: payload.taxYear,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      payload: JSON.stringify(payload),
      generatedBy: input.generatedBy,
    },
    select: { id: true, taxYear: true },
  });

  return record;
}

export async function voidIt3Snapshot(
  prisma: PrismaClient,
  id: string,
  reason: string,
): Promise<void> {
  await prisma.it3Snapshot.update({
    where: { id },
    data: {
      voidedAt: new Date(),
      voidReason: reason,
    },
  });
}

/** Parse a stored snapshot back into its typed payload. */
export function parseStoredPayload(raw: string): It3SnapshotPayload {
  return JSON.parse(raw) as It3SnapshotPayload;
}
