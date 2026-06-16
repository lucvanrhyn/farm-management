// lib/calculators/profit-per-camp.ts
//
// Pure calculators for Profit-Per-Camp lite v1 (ADR-0012, last-camp rule).
//
// This is a REPORTING roll-up over FarmTrack's existing finance layer — NOT a
// second ledger. `getFinancialKPIs` stays the authoritative farm total.
//
// Attribution (symmetric for income and cost):
//   • single animalId          -> credit that animal's currentCamp (last camp)
//   • batch animalIds (JSON[])  -> split amount EVENLY, each share to that
//                                  animal's own currentCamp
//   • explicit campId           -> that camp
//   • none resolvable           -> UNALLOCATED (never spread across camps)
//
// Normalisation: profitPerLsu = profit / campLSU; profitPerHa = profit /
// sizeHectares. Both null when the denominator is 0 or absent.

/** A finance transaction reduced to only the fields attribution needs. */
export interface ProfitTxInput {
  type: string; // "income" | "expense"
  amount: number;
  animalId?: string | null;
  /** JSON array of animal ids for a batch sale, e.g. '["A1","A2"]'. */
  animalIds?: string | null;
  campId?: string | null;
}

/** Result of attributing a set of single-type txs across camps. */
export interface CampAttribution {
  /** campId -> summed amount attributed to that camp. */
  byCamp: Map<string, number>;
  /** amount that could not be resolved to any camp. */
  unallocated: number;
}

/**
 * Defensively parse a JSON array of animal ids. Malformed / non-array input
 * yields an empty list so the caller routes the whole share to unallocated.
 */
function parseAnimalIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string");
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Attribute each tx's amount to a camp using the last-camp rule, accumulating
 * an unallocated bucket for anything that cannot be resolved.
 *
 * @param txs            transactions of a SINGLE type (all income or all expense)
 * @param animalLastCamp map of animalId -> currentCamp (its last/finishing camp)
 */
export function attributeAmountsToCamps(
  txs: ReadonlyArray<ProfitTxInput>,
  animalLastCamp: Readonly<Record<string, string>>,
): CampAttribution {
  const byCamp = new Map<string, number>();
  let unallocated = 0;

  const credit = (campId: string, amount: number) => {
    byCamp.set(campId, (byCamp.get(campId) ?? 0) + amount);
  };

  for (const tx of txs) {
    // 1. Single animalId -> last camp (takes precedence over any campId).
    if (tx.animalId) {
      const camp = animalLastCamp[tx.animalId];
      if (camp) credit(camp, tx.amount);
      else unallocated += tx.amount;
      continue;
    }

    // 2. Batch animalIds -> even split, each share to that animal's own camp.
    const ids = parseAnimalIds(tx.animalIds);
    if (ids.length > 0) {
      const share = tx.amount / ids.length;
      for (const id of ids) {
        const camp = animalLastCamp[id];
        if (camp) credit(camp, share);
        else unallocated += share;
      }
      continue;
    }

    // 3. Explicit campId.
    if (tx.campId) {
      credit(tx.campId, tx.amount);
      continue;
    }

    // 4. Nothing resolvable -> overhead / unallocated.
    unallocated += tx.amount;
  }

  return { byCamp, unallocated };
}

export interface ProfitPerCampRow {
  campId: string;
  campName: string;
  income: number;
  cost: number;
  profit: number;
  lsu: number;
  profitPerLsu: number | null;
  hectares: number | null;
  profitPerHa: number | null;
}

export interface UnallocatedSummary {
  income: number;
  cost: number;
  net: number;
}

export interface ProfitPerCampRollupInput {
  incomeTxs: ReadonlyArray<ProfitTxInput>;
  expenseTxs: ReadonlyArray<ProfitTxInput>;
  /** animalId -> currentCamp (last/finishing camp). */
  animalLastCamp: Readonly<Record<string, string>>;
  /** camp metadata (name + size) for naming + per-ha normalisation. */
  camps: ReadonlyArray<{ campId: string; campName: string; sizeHectares: number | null }>;
  /** Active-only animal categories per camp, for the LSU denominator. */
  activeAnimalsByCamp: Readonly<Record<string, ReadonlyArray<{ category: string }>>>;
  /** Merged LSU lookup across all species. */
  lsuValues: Readonly<Record<string, number>>;
}

export interface ProfitPerCampRollup {
  rows: ProfitPerCampRow[];
  unallocated: UnallocatedSummary;
}

/** Sum the LSU contribution of a camp's active animals via the merged lookup. */
function campLsu(
  animals: ReadonlyArray<{ category: string }>,
  lsuValues: Readonly<Record<string, number>>,
): number {
  return animals.reduce((sum, a) => sum + (lsuValues[a.category] ?? 1.0), 0);
}

/**
 * Roll income + cost up to the camp level and normalise by LSU + hectares.
 * Returns rows sorted by profit DESC plus a separate unallocated summary.
 */
export function rollUpProfitByCamp(
  input: ProfitPerCampRollupInput,
): ProfitPerCampRollup {
  const {
    incomeTxs,
    expenseTxs,
    animalLastCamp,
    camps,
    activeAnimalsByCamp,
    lsuValues,
  } = input;

  const income = attributeAmountsToCamps(incomeTxs, animalLastCamp);
  const cost = attributeAmountsToCamps(expenseTxs, animalLastCamp);

  const campMeta = new Map(camps.map((c) => [c.campId, c]));

  // Every camp that received income OR cost gets a row.
  const campIds = new Set<string>([
    ...income.byCamp.keys(),
    ...cost.byCamp.keys(),
  ]);

  const rows: ProfitPerCampRow[] = [];
  for (const campId of campIds) {
    const meta = campMeta.get(campId);
    const inc = income.byCamp.get(campId) ?? 0;
    const cst = cost.byCamp.get(campId) ?? 0;
    const profit = inc - cst;

    const lsu = campLsu(activeAnimalsByCamp[campId] ?? [], lsuValues);
    const profitPerLsu = lsu > 0 ? profit / lsu : null;

    const hectares = meta?.sizeHectares ?? null;
    const profitPerHa = hectares && hectares > 0 ? profit / hectares : null;

    rows.push({
      campId,
      campName: meta?.campName ?? campId,
      income: inc,
      cost: cst,
      profit,
      lsu,
      profitPerLsu,
      hectares,
      profitPerHa,
    });
  }

  rows.sort((a, b) => b.profit - a.profit);

  const unallocated: UnallocatedSummary = {
    income: income.unallocated,
    cost: cost.unallocated,
    net: income.unallocated - cost.unallocated,
  };

  return { rows, unallocated };
}
