// lib/domain/transactions/animal-profitability-view.ts
//
// Disposed-inclusive + projected per-animal profitability view for the dedicated
// /admin/profitability page (CONTEXT.md "Profitability section" + "Estimated
// sale value"). Distinct from `getProfitabilityByAnimal` (which is Active-only,
// realised-only, and feeds the existing per-category lazy expansion):
//
//   - Realised columns (income / expenses / realisedMargin) span the
//     disposed-inclusive roster {Active, Sold, Deceased, Culled} so banked sale
//     margin from a sold/deceased/culled animal appears (it would otherwise be
//     silently dropped by the Active-only filter). Computed via the reconciled
//     `calcProfitabilityByAnimal` (purchasePrice column-wins over tagged
//     "Animal Purchases" tx).
//
//   - Projected columns (projectedValue / projectedMargin / projectedBasis) are
//     for ACTIVE animals only — the value driver while the animal is still on the
//     farm. projectedMargin = projectedValue − expenses (realised expenses to
//     date, against a not-yet-banked estimate). Disposed animals carry
//     projectedValue=null, projectedMargin=null, projectedBasis="none" — once an
//     animal is sold its actual sale Transaction is the realised truth.
//
// Honesty discipline (ADR-0012): projected margin is NEVER summed with realised
// income; `getFinancialKPIs` stays the authoritative farm total.

import type { PrismaClient } from "@prisma/client";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { parseSpeciesThresholds } from "@/lib/server/alerts/helpers";
import {
  calcProfitabilityByAnimal,
  type AnimalProfitabilityInput,
} from "@/lib/calculators/profitability-per-animal";
import {
  estimateSaleValue,
  type ProjectedBasis,
} from "@/lib/calculators/projected-sale-value";
import { parseWeighingMassKg } from "@/lib/domain/observations/weighing-mass";

export interface AnimalProfitabilityViewRow {
  animalId: string;
  tagNumber: string;
  name: string | null;
  category: string;
  status: string;
  income: number;
  expenses: number;
  realisedMargin: number;
  projectedValue: number | null;
  projectedMargin: number | null;
  projectedBasis: ProjectedBasis;
}

export async function getAnimalProfitabilityView(
  prisma: PrismaClient,
  dateRange?: { from: string; to: string },
): Promise<AnimalProfitabilityViewRow[]> {
  const txWhere = dateRange
    ? { date: { gte: dateRange.from, lte: dateRange.to } }
    : {};

  const [transactions, animals, settings] = await Promise.all([
    // Non-species Transaction model — raw prisma is allowed. category is read so
    // the calc can reconcile purchasePrice column-wins against tagged purchases.
    // audit-allow-findmany: full period transaction set required for accurate per-animal totals; bounded by the date range.
    prisma.transaction.findMany({
      where: txWhere,
      select: { animalId: true, campId: true, type: true, amount: true, category: true },
    }),
    // Disposed-inclusive roster: a Sold/Deceased/Culled animal retains its
    // currentCamp (last/finishing camp) and carries its banked sale income AND
    // its animal-tagged costs, all of which must surface as realised margin. The
    // literal status:{in:[...]} predicate satisfies the deceased-flag audit
    // (matches getProfitPerCamp). Projected value is gated to Active animals
    // downstream — disposed animals already have their realised truth.
    // audit-allow-findmany: full disposed+active roster required for last-camp income attribution.
    crossSpecies(prisma, "farm-wide-audit").animal.findMany({
      where: { status: { in: ["Active", "Sold", "Deceased", "Culled"] } },
      select: {
        animalId: true,
        name: true,
        category: true,
        currentCamp: true,
        status: true,
        species: true,
        purchasePrice: true,
        estimatedValue: true,
      },
    }),
    prisma.farmSettings.findFirst({
      select: { speciesAlertThresholds: true },
    }),
  ]);

  // --- Realised: reconciled per-animal income/expenses over disposed-inclusive roster.
  const taggedTransactions: AnimalProfitabilityInput["taggedTransactions"] = transactions
    .filter((t) => t.animalId != null)
    .map((t) => ({
      animalId: t.animalId!,
      type: t.type.toLowerCase(),
      amount: t.amount,
      category: t.category,
    }));

  const campTransactions: AnimalProfitabilityInput["campTransactions"] = transactions
    .filter((t) => t.campId != null && t.animalId == null)
    .map((t) => ({
      campId: t.campId!,
      type: t.type.toLowerCase(),
      amount: t.amount,
    }));

  const animalInputs: AnimalProfitabilityInput["animals"] = animals.map((a) => ({
    animalId: a.animalId,
    tagNumber: a.animalId,
    name: a.name,
    category: a.category,
    currentCamp: a.currentCamp,
    purchasePrice: a.purchasePrice,
    // Camp-tagged expenses split across ACTIVE animals only — a disposed animal
    // keeps its last camp but must not dilute current animals' share nor be
    // charged costs incurred after it left (it still gets its own tagged income/costs).
    active: a.status === "Active",
  }));

  const realisedRows = calcProfitabilityByAnimal({
    taggedTransactions,
    campTransactions,
    animals: animalInputs,
  });
  const realisedByTag = new Map(realisedRows.map((r) => [r.animalId, r]));

  // --- Projected: latest weighing mass per Active animal tag.
  const activeAnimals = animals.filter((a) => a.status === "Active");
  const latestWeightByTag = new Map<string, number>();
  if (activeAnimals.length > 0) {
    const activeTags = activeAnimals.map((a) => a.animalId);
    // Latest weighing per active tag — observations carry weight_kg in details.
    // `observedAt` MUST be in the select: the libsql query engine panics ("no
    // entry found for key", query-structure/record.rs) when it orders by a
    // column that is absent from the projection, and that surfaces at scale
    // (a large active herd). The sibling get-triage weighings read selects
    // observedAt for the same reason.
    // audit-allow-findmany: weighing observations for active roster; bounded to the active tag set + type.
    const weighings = await crossSpecies(prisma, "farm-wide-audit").observation.findMany({
      where: { type: "weighing", animalId: { in: activeTags } },
      orderBy: { observedAt: "asc" },
      select: { animalId: true, observedAt: true, details: true },
    });
    // Ascending order means the last write per tag is the latest weighing.
    for (const obs of weighings) {
      if (!obs.animalId) continue;
      const w = parseWeighingMassKg(obs.details);
      if (w != null) {
        latestWeightByTag.set(obs.animalId, w);
      }
    }
  }

  // Resolve per-species sale-price-per-kg + value-per-head from the settings blob.
  // Shape: { cattle: { marketPricePerKg: 45, valuePerHead: 11000 }, sheep: {...} }
  const speciesThresholds = parseSpeciesThresholds(settings?.speciesAlertThresholds);
  const resolveNum = (species: string, key: string): number | null => {
    const raw = speciesThresholds[species]?.[key];
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
  };

  const rows = animals.map((a) => {
    const realised = realisedByTag.get(a.animalId);
    const income = realised?.income ?? 0;
    const expenses = realised?.expenses ?? 0;
    const realisedMargin = income - expenses;

    // Projected only for live (Active) animals; disposed animals have realised truth.
    if (a.status !== "Active") {
      return {
        animalId: a.animalId,
        tagNumber: a.animalId,
        name: a.name,
        category: a.category,
        status: a.status,
        income,
        expenses,
        realisedMargin,
        projectedValue: null,
        projectedMargin: null,
        projectedBasis: "none" as ProjectedBasis,
      };
    }

    const { value: projectedValue, basis: projectedBasis } = estimateSaleValue({
      species: a.species,
      latestWeightKg: latestWeightByTag.get(a.animalId) ?? null,
      estimatedValueOverride: a.estimatedValue,
      marketPricePerKg: resolveNum(a.species, "marketPricePerKg"),
      valuePerHead: resolveNum(a.species, "valuePerHead"),
    });

    return {
      animalId: a.animalId,
      tagNumber: a.animalId,
      name: a.name,
      category: a.category,
      status: a.status,
      income,
      expenses,
      realisedMargin,
      projectedValue,
      // Projected margin against realised expenses to date (a live animal not
      // yet sold); shown distinctly, never summed with realised income.
      projectedMargin: projectedValue != null ? projectedValue - expenses : null,
      projectedBasis,
    };
  });

  // Best-to-worst realised margin, mirroring calcProfitabilityByAnimal +
  // rollUpProfitByCategory so the Animal axis is not an arbitrary DB-order dump.
  return rows.sort((a, b) => b.realisedMargin - a.realisedMargin);
}
