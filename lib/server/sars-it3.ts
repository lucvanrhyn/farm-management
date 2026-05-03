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
import {
  summariseStockMovement,
  valueStockBlock,
  type StockBlockTotal,
} from "@/lib/calculators/sars-stock";
import {
  STANDARD_VALUES_SOURCE,
  type ElectionRecord,
} from "@/lib/calculators/sars-livestock-values";
import { reconstructStockSnapshots } from "@/lib/server/inventory-replay";

/**
 * Prisma `select` shape for transactions consumed by `getIt3Payload`.
 *
 * Exported (and unit-tested) because a missing field here is a *silent*
 * correctness bug: the omitted column lands as `undefined` on each row, and
 * downstream consumers (`splitTransactionsByForeignness`, `computeIt3Schedules`)
 * treat undefined as the default. Wave/26e (foreign-income code 0192/0193)
 * shipped without `isForeign` in this select, which made every transaction
 * look domestic regardless of the persisted flag. Lock the shape with a test.
 */
export const TRANSACTION_SELECT_FOR_IT3 = {
  type: true,
  category: true,
  amount: true,
  date: true,
  description: true,
  isForeign: true,
} as const;

// ── Snapshot shape ────────────────────────────────────────────────────────────

export interface FarmIdentitySnapshot {
  farmName: string;
  ownerName: string;
  ownerIdNumber: string;
  /**
   * SARS Tax Reference Number — the *one* identifier SARS uses to key the
   * return. 10 digits, but accept any string the user types; SARS validates
   * at submission. Optional in the payload type so legacy snapshots
   * (issued before wave/26c) parse without runtime error.
   */
  taxReferenceNumber?: string;
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

export interface It3StockBlockSnapshot {
  asOfDate: string; // ISO YYYY-MM-DD
  totalZar: number;
  electionApplied: boolean;
  lines: Array<{
    species: string;
    ageCategory: string;
    count: number;
    standardValueZar: number;
    effectiveValueZar: number;
    subtotalZar: number;
  }>;
}

export interface It3StockMovementSnapshot {
  opening: It3StockBlockSnapshot;
  closing: It3StockBlockSnapshot;
  deltaZar: number;
  /** Animals that couldn't be mapped — taxpayer must value separately. */
  unmapped: Array<{ animalId: string; species: string; category: string }>;
  /** Citation block emitted into the PDF footer. */
  source: string;
}

export interface It3SnapshotPayload {
  taxYear: number;
  periodStart: string;
  periodEnd: string;
  farm: FarmIdentitySnapshot;
  schedules: It3ScheduleTotals;
  inventory: It3LivestockInventorySnapshot;
  /**
   * Opening + closing stock at standard values per First Schedule paragraph
   * 5(1). Optional — older snapshots issued before wave/26b will not have
   * this block; the PDF renderer falls back to "stock movement not computed".
   */
  stockMovement?: It3StockMovementSnapshot;
  meta: {
    generatedAtIso: string;
    generatedBy: string | null;
    sourceTransactionCount: number;
    categoryMapVersion: string;
    mappedCategories: string[];
    /** SARS ITR12 farming activity code (e.g. "0104" Livestock Profit). */
    farmingActivityCode?: string;
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
    taxReferenceNumber: settings?.taxReferenceNumber ?? "",
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
  // cross-species by design: SARS IT3 inventory covers all livestock by category.
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
 * Load taxpayer livestock-value elections that apply to a given tax year.
 *
 * Returns the *binding* election per `(species, ageCategory)` whose
 * `electedYear <= taxYear`, applying the SARS First Schedule paragraph 7
 * lock-in defensively at the read path:
 *
 *   "Once an option is exercised, it shall be binding in respect of all
 *    subsequent returns rendered by the farmer and may not be varied
 *    without the consent of the Commissioner."
 *   — IT35 (2023-10-13) Annexure pp. 71-72, paragraph 7
 *
 * Resolution rules per class, walking in descending `electedYear`:
 *
 *   1. The first row encountered is the candidate winner.
 *   2. A LATER row may only override an EARLIER row when the later row
 *      carries a non-empty `sarsChangeApprovalRef` (i.e. SARS has consented
 *      to the re-election). An unapproved later row is skipped — the
 *      earlier locked election remains binding, per Para 7.
 *   3. Empty-string `sarsChangeApprovalRef` is treated as no approval —
 *      a defensive guard against data-entry sentinel values.
 *
 * Why this is the read-path defence (not just data-layer):
 *   - The schema's `@@unique([species, ageCategory, electedYear])` blocks
 *     duplicate rows for the SAME year, but does NOT prevent a careless
 *     operator inserting a different value in a LATER year without setting
 *     `sarsChangeApprovalRef`. There is no insert API today (the management
 *     page at app/[farmSlug]/admin/tax/elections/page.tsx is read-only and
 *     elections are inserted via Turso shell). The loader is therefore the
 *     last line of defence against an unapproved silent override.
 *
 * Exported (and unit-tested in `__tests__/server/sars-it3-elections.test.ts`)
 * because the lock-in invariant + the year filter are both regulatory-
 * correctness gates: a silent change to either would mis-value every
 * taxpayer's stock block. Internal-tests-pass ≠ external-spec-correct — see
 * `feedback-regulatory-output-validate-against-spec.md`.
 *
 * Backwards compatibility: legacy tenants whose Turso clone has not yet had
 * the SarsLivestockElection migration applied (originally `0005_…`, renamed
 * to `0010_…` in PR #56) will surface a runtime "no such table" error from
 * libSQL. We catch that and return `[]` — equivalent to "no elections", which
 * causes the calculator to fall back to gazetted standard values, the
 * SARS-correct default behaviour absent any election.
 */
export async function loadElectionsForYear(
  prisma: PrismaClient,
  taxYear: number,
): Promise<ElectionRecord[]> {
  try {
    const rows = await prisma.sarsLivestockElection.findMany({
      where: { electedYear: { lte: taxYear } },
      orderBy: { electedYear: "desc" },
    });
    // Para-7 lock-in resolver. Walk desc-year. For each (species, ageCategory)
    // class, the EARLIEST election is binding; a later row only overrides it
    // when it carries SARS approval. Practically, in desc-year iteration,
    // skip any later row that lacks approval and let the next-older row win.
    const winners = new Map<string, ElectionRecord>();
    for (const r of rows) {
      const key = `${r.species}/${r.ageCategory}`;
      if (winners.has(key)) {
        // Already locked in by a later (or this) row — older rows only
        // surface here when the newer one was skipped, which means the
        // older row IS the binding one. Keep it.
        continue;
      }
      const approval = r.sarsChangeApprovalRef;
      const hasApproval =
        typeof approval === "string" && approval.trim().length > 0;
      // For the newest row in a class we have not yet seen, accept it
      // unconditionally (it may be the *first* election for the class —
      // first elections do not need approval). We then peek at older rows;
      // if an older unapproved row exists for the same class, the unapproved
      // newer row is invalid and we should fall back. We detect that case
      // by deferring acceptance until we have inspected the next older row.
      //
      // Implementation: if an older row exists for this class, then the
      // current newer row must carry approval to override it. If no older
      // row exists, the current row IS the first election for the class
      // and is binding regardless of approval ref.
      const olderExists = rows.some(
        (other) =>
          other !== r &&
          other.species === r.species &&
          other.ageCategory === r.ageCategory &&
          other.electedYear < r.electedYear,
      );
      if (olderExists && !hasApproval) {
        // Skip this unapproved later row — it does not override the
        // earlier lock-in per Para 7. The next iteration will reach the
        // older row and accept it.
        continue;
      }
      winners.set(key, {
        species: r.species,
        ageCategory: r.ageCategory,
        electedValueZar: r.electedValueZar,
        electedYear: r.electedYear,
        sarsChangeApprovalRef: r.sarsChangeApprovalRef,
      });
    }
    return [...winners.values()];
  } catch {
    return [];
  }
}

function blockToSnapshot(
  asOfDate: string,
  block: StockBlockTotal,
): It3StockBlockSnapshot {
  return {
    asOfDate,
    totalZar: block.totalZar,
    electionApplied: block.electionApplied,
    lines: block.lines.map((l) => ({
      species: l.species,
      ageCategory: l.ageCategory,
      count: l.count,
      standardValueZar: l.standardValueZar,
      effectiveValueZar: l.effectiveValueZar,
      subtotalZar: l.subtotalZar,
    })),
  };
}

/**
 * Aggregate a tax-year IT3 payload for the given tax year (YYYY = calendar
 * year the SA Feb falls in). Does NOT persist anything — caller decides
 * whether to preview or commit.
 *
 * As of wave/26b this includes opening/closing stock at standard values per
 * First Schedule paragraph 5(1) and rolls the delta into netFarmingIncome.
 */
export async function getIt3Payload(
  prisma: PrismaClient,
  taxYear: number,
  generatedBy: string | null,
): Promise<It3SnapshotPayload> {
  const { start, end } = getSaTaxYearRange(taxYear);

  const [transactions, farm, inventory, replay, elections] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: { gte: start, lte: end } },
      select: TRANSACTION_SELECT_FOR_IT3,
    }),
    buildFarmIdentitySnapshot(prisma),
    buildInventorySnapshot(prisma),
    reconstructStockSnapshots(prisma, taxYear),
    loadElectionsForYear(prisma, taxYear),
  ]);

  const movement = summariseStockMovement(replay.opening, replay.closing, elections);
  const openingBlock = valueStockBlock(replay.opening, elections);
  const closingBlock = valueStockBlock(replay.closing, elections);

  const schedules = computeIt3Schedules(
    transactions as TransactionLike[],
    taxYear,
    {
      stockMovement: movement,
    },
  );

  const stockMovement: It3StockMovementSnapshot = {
    opening: blockToSnapshot(start, openingBlock),
    closing: blockToSnapshot(end, closingBlock),
    deltaZar: movement.deltaZar,
    unmapped: replay.unmapped.map((u) => ({
      animalId: u.animalId,
      species: u.species,
      category: u.category,
    })),
    source: STANDARD_VALUES_SOURCE,
  };

  return {
    taxYear,
    periodStart: start,
    periodEnd: end,
    farm,
    schedules,
    inventory,
    stockMovement,
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
