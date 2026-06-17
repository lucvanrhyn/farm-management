// lib/server/profit-per-camp/get-profit-per-camp.ts
//
// Server fetch shell for Profit-Per-Camp lite v1.
//
// Reads the three inputs the pure calculator needs and wires them together:
//   1. income + expense transactions over the date STRING range (non-species
//      Transaction model -> raw prisma.transaction is allowed)
//   2. camps (name + size) via the farm-wide cross-species door
//   3. animals where status in {Active, Sold, Deceased, Culled} via the farm-wide
//      door — a Sold/Deceased/Culled animal retains its currentCamp (its
//      last/finishing camp) and carries its income (sale, slaughter/mortality,
//      cull-for-meat); ACTIVE animals alone drive each camp's LSU denominator.
//
// This is a REPORTING view, not a second ledger — getFinancialKPIs remains the
// authoritative farm total (ADR-0012).

import type { PrismaClient } from "@prisma/client";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { getMergedLsuValues } from "@/lib/species/registry";
import {
  rollUpProfitByCamp,
  type ProfitTxInput,
  type ProfitPerCampRow,
  type UnallocatedSummary,
} from "@/lib/calculators/profit-per-camp";

export type { ProfitPerCampRow, UnallocatedSummary };

export interface ProfitPerCampResult {
  rows: ProfitPerCampRow[];
  unallocated: UnallocatedSummary;
  periodLabel?: string;
}

export async function getProfitPerCamp(
  prisma: PrismaClient,
  farmSlug: string,
  dateRange?: { from: string; to: string },
): Promise<ProfitPerCampResult> {
  void farmSlug; // multi-tenant routing happens upstream; prisma is already scoped

  const txWhere = dateRange
    ? { date: { gte: dateRange.from, lte: dateRange.to } }
    : {};

  const [transactions, camps, animals] = await Promise.all([
    // Non-species Transaction model — raw prisma is allowed. Bounding to a
    // `take:` cap would silently drop transactions and corrupt the period
    // totals, so the full filtered set is read by design.
    // audit-allow-findmany: full period transaction set required for accurate per-camp totals; bounded by the date range.
    prisma.transaction.findMany({
      where: txWhere,
      select: {
        type: true,
        amount: true,
        animalId: true,
        animalIds: true,
        campId: true,
      },
    }),
    // audit-allow-findmany: every camp needed for name + per-ha normalisation; one bounded row per camp.
    crossSpecies(prisma, "farm-wide-audit").camp.findMany({
      select: { campId: true, campName: true, sizeHectares: true },
    }),
    // Active animals drive the LSU denominator; Sold/Deceased/Culled animals
    // carry income (sale, slaughter/mortality, cull-for-meat) and their last
    // camp, so they must be in the roster or that income leaks to "unallocated".
    // The literal status:{in:[...]} predicate satisfies the deceased-flag audit;
    // the LSU denominator stays Active-only via the status guard below.
    // audit-allow-findmany: full disposed+active roster required for last-camp income attribution.
    crossSpecies(prisma, "farm-wide-audit").animal.findMany({
      where: { status: { in: ["Active", "Sold", "Deceased", "Culled"] } },
      select: { animalId: true, category: true, currentCamp: true, status: true },
    }),
  ]);

  const incomeTxs: ProfitTxInput[] = [];
  const expenseTxs: ProfitTxInput[] = [];
  for (const tx of transactions) {
    const row: ProfitTxInput = {
      type: tx.type,
      amount: tx.amount,
      animalId: tx.animalId,
      animalIds: tx.animalIds,
      campId: tx.campId,
    };
    if (tx.type === "income") incomeTxs.push(row);
    else expenseTxs.push(row);
  }

  // animalId -> currentCamp (last/finishing camp) for both Active and Sold.
  const animalLastCamp: Record<string, string> = {};
  // Active-only animal categories per camp, for the LSU denominator.
  const activeAnimalsByCamp: Record<string, { category: string }[]> = {};
  for (const a of animals) {
    animalLastCamp[a.animalId] = a.currentCamp;
    if (a.status === "Active") {
      (activeAnimalsByCamp[a.currentCamp] ??= []).push({ category: a.category });
    }
  }

  const { rows, unallocated } = rollUpProfitByCamp({
    incomeTxs,
    expenseTxs,
    animalLastCamp,
    camps: camps.map((c) => ({
      campId: c.campId,
      campName: c.campName,
      sizeHectares: c.sizeHectares ?? null,
    })),
    activeAnimalsByCamp,
    lsuValues: getMergedLsuValues(),
  });

  const periodLabel = dateRange ? `${dateRange.from} – ${dateRange.to}` : "Last 365 days";

  return { rows, unallocated, periodLabel };
}
