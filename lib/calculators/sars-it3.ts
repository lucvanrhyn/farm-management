/**
 * lib/calculators/sars-it3.ts
 *
 * Pure calculator for the SARS / IT3 farming tax export (ITR12 Schedule for
 * farming income — section published by SARS under the "Farming Operations"
 * heading of the individual income-tax return).
 *
 * No side effects, no I/O. All functions take plain data and return plain data
 * so they can be unit-tested without a database.
 *
 * SA tax year = 1 March → end of February. `taxYearEndingIn` refers to the
 * calendar year the Feb belongs to (e.g. `2026` → 2025-03-01..2026-02-28).
 *
 * The generated report is advisory, NOT an e-filing submission. Farmers paste
 * the totals into their e-filing return — SARS line codes shown here use the
 * historical codes published in the ITR12 guide; they may shift year-to-year
 * and should be treated as labels, not legally-binding references.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type It3ScheduleKey = "income" | "expense";

export interface It3Line {
  /** Canonical SARS line label (displayed in the PDF and CSV). */
  line: string;
}

export interface It3MappedCategory extends It3Line {
  schedule: It3ScheduleKey;
  /** The FarmTrack `Transaction.category` this line maps from. */
  sourceCategory: string;
}

/**
 * Input for deriving the SARS ITR12 top-level farming activity code.
 *
 * SARS ITR12 uses a single 4-digit profit/loss code to classify the dominant
 * farming activity (e.g. 0104 Livestock Farming Profit, 0105 Loss). These are
 * the real codes from the SARS "Find a Source Code" register.
 *
 * Reference: https://www.sars.gov.za/types-of-tax/personal-income-tax/filing-season/find-a-source-code/
 */
export interface FarmingActivityCodeInput {
  /** The dominant species class. Null/undefined → mixed farming (0102/0103). */
  dominantSpecies?: string | null;
  /** "profit" or "loss" based on net farming income sign. */
  netResult: "profit" | "loss";
}

/**
 * Derive the SARS ITR12 top-level farming activity code from the dominant
 * species and net profit/loss result.
 *
 * Pairs (profit / loss):
 *   0102/0103 Mixed farming (default)
 *   0104/0105 Livestock Farming
 *   0108/0109 Milk (Dairy)
 *   0114/0115 Poultry
 *   0140/0141 Wool (Sheep)
 *   0142/0143 Game Farming
 *   0192/0193 Foreign farming income (any farming income earned outside SA —
 *             e.g. SA tenants leasing cross-border in Lesotho/Eswatini)
 *
 * The per-line codes (4101..4299) that appeared in earlier FarmTrack versions
 * were fabricated and are NOT used here. Only the top-level activity code is
 * real and required on the ITR12.
 */
export function getFarmingActivityCode(input: FarmingActivityCodeInput): string {
  const { dominantSpecies, netResult } = input;
  const profit = netResult === "profit";

  const species = (dominantSpecies ?? "").toLowerCase();

  if (species === "foreign") {
    return profit ? "0192" : "0193";
  }
  if (species === "cattle" || species === "livestock") {
    return profit ? "0104" : "0105";
  }
  if (species === "sheep" || species === "wool") {
    return profit ? "0140" : "0141";
  }
  if (species === "game") {
    return profit ? "0142" : "0143";
  }
  if (species === "dairy" || species === "milk") {
    return profit ? "0108" : "0109";
  }
  if (species === "poultry") {
    return profit ? "0114" : "0115";
  }
  // Default: mixed farming
  return profit ? "0102" : "0103";
}

export interface TransactionLike {
  type: string;              // "income" | "expense"
  category: string;          // maps onto IT3 line
  amount: number;            // Rand, always positive
  date: string;              // YYYY-MM-DD (SA locale)
  description?: string | null;
  /**
   * True when this transaction's income/expense was earned outside South
   * Africa (Lesotho/Eswatini/etc.). Drives SARS source code 0192/0193 on
   * the ITR12. Optional for backward-compat with legacy callers — undefined
   * is treated as domestic (false).
   */
  isForeign?: boolean | null;
}

/**
 * Pure split: partition a transaction list into domestic (default) vs foreign
 * (isForeign === true) buckets. Used by `computeIt3Schedules` so the foreign-
 * derived rows roll into a parallel SARS 0192/0193 reporting block.
 */
export function splitTransactionsByForeignness(
  transactions: TransactionLike[],
): { domestic: TransactionLike[]; foreign: TransactionLike[] } {
  const domestic: TransactionLike[] = [];
  const foreign: TransactionLike[] = [];
  for (const tx of transactions) {
    if (tx?.isForeign === true) foreign.push(tx);
    else domestic.push(tx);
  }
  return { domestic, foreign };
}

export interface It3ScheduleLineTotal {
  line: string;
  /** Kept for backward-compat with stored JSON payloads. Always empty string now.
   *  Per-line SARS codes do not exist on the ITR12 farming schedule. */
  code: string;
  amount: number;
  sourceCategories: string[]; // which Transaction categories contributed
  count: number;              // number of transactions rolled into this line
}

export interface It3ScheduleTotals {
  income: It3ScheduleLineTotal[];
  expense: It3ScheduleLineTotal[];
  totalIncome: number;
  totalExpenses: number;
  /**
   * Net farming income per First Schedule paragraph 5(1):
   *   net = grossSales − allowableDeductions + (closingStock − openingStock)
   * When `stockMovement` is omitted from compute options, the trailing
   * stock-movement term is zero (backward-compat path for callers not yet
   * wired to the inventory replay).
   */
  netFarmingIncome: number;
  /** netFarmingIncome before adding the stock movement delta. Always set. */
  netFarmingIncomeBeforeStockMovement?: number;
  /** Opening livestock value at standard values (R), if computed. */
  openingStockValueZar?: number;
  /** Closing livestock value at standard values (R), if computed. */
  closingStockValueZar?: number;
  /** closingStockValueZar − openingStockValueZar. Rolls into netFarmingIncome. */
  stockMovementZar?: number;
  transactionCount: number;
  /**
   * SARS ITR12 top-level farming activity code, e.g. "0104" (Livestock Farming
   * Profit) or "0105" (Livestock Farming Loss). Derived from dominantSpecies +
   * sign of netFarmingIncome. This is the real SARS code that goes on the ITR12.
   */
  farmingActivityCode: string;
  /**
   * Foreign-derived totals (SARS code 0192 profit / 0193 loss). Null when no
   * foreign-flagged transactions exist in the period — backward-compat for
   * legacy callers / UIs.
   *
   * When present, these totals are EXCLUDED from the main income/expense/
   * netFarmingIncome figures: they're a parallel SA-tax-jurisdiction reporting
   * line on the ITR12, not a re-aggregation of the same revenue.
   */
  foreignFarmingIncome?: It3ForeignFarmingIncome | null;
}

/**
 * Parallel SARS-0192/0193 reporting block — sums of all transactions where
 * `isForeign === true`. Carries its own activity code.
 */
export interface It3ForeignFarmingIncome {
  income: It3ScheduleLineTotal[];
  expense: It3ScheduleLineTotal[];
  totalIncome: number;
  totalExpenses: number;
  net: number;
  /** "0192" (profit) or "0193" (loss). */
  activityCode: string;
}

// ── SARS ITR12 farming schedule line descriptions ─────────────────────────────
//
// Maps FarmTrack default category names onto SARS ITR12 farming schedule line
// descriptions. Keys are case-sensitive and must match
// lib/constants/default-categories.ts exactly.
//
// Per-line SARS codes (the old 4101..4299 range) have been REMOVED because:
//   - Those codes were entirely fabricated and do not exist on the ITR12.
//   - 4101/4102 are PAYE codes from the IT3(a) payroll certificate.
//   - The real ITR12 farming schedule uses only a single top-level activity
//     code (e.g. 0104 Livestock Farming Profit) — there are no per-line codes
//     for the individual income/expense rows.
//
// The top-level farming activity code is derived via getFarmingActivityCode()
// and stored at It3ScheduleTotals.farmingActivityCode.

export const IT3_SCHEDULE_MAP: Record<string, It3MappedCategory> = {
  // ─ Income lines ─
  "Animal Sales": {
    schedule: "income",
    line: "Sales of livestock",
    sourceCategory: "Animal Sales",
  },
  "Livestock Production": {
    schedule: "income",
    line: "Livestock production and other farming income",
    sourceCategory: "Livestock Production",
  },
  "Subsidies": {
    schedule: "income",
    line: "Government subsidies and rebates",
    sourceCategory: "Subsidies",
  },

  // ─ Expense lines ─
  // NOTE: "Animal Purchases" is categorised by the shipped defaults as
  // `type: "income"` (a historical quirk in default-categories.ts), but
  // economically it is a cost of sales line. We remap it to the expense
  // schedule here so the ITR12 totals reflect economic reality.
  "Animal Purchases": {
    schedule: "expense",
    line: "Livestock purchases (cost of sales)",
    sourceCategory: "Animal Purchases",
  },
  "Feed/Supplements": {
    schedule: "expense",
    line: "Feed and supplements",
    sourceCategory: "Feed/Supplements",
  },
  "Medication/Vet": {
    schedule: "expense",
    line: "Veterinary services and medicine",
    sourceCategory: "Medication/Vet",
  },
  "Labour": {
    schedule: "expense",
    line: "Wages and salaries",
    sourceCategory: "Labour",
  },
  "Fuel/Transport": {
    schedule: "expense",
    line: "Fuel and transport",
    sourceCategory: "Fuel/Transport",
  },
  "Equipment/Repairs": {
    schedule: "expense",
    line: "Repairs and maintenance",
    sourceCategory: "Equipment/Repairs",
  },
  "Camp Maintenance": {
    schedule: "expense",
    line: "Camp and land maintenance",
    sourceCategory: "Camp Maintenance",
  },
};

export const IT3_OTHER_INCOME_LINE: It3Line = {
  line: "Other farming income",
};

export const IT3_OTHER_EXPENSE_LINE: It3Line = {
  line: "Other farming expenses",
};

// ── SA tax year helpers ───────────────────────────────────────────────────────

/**
 * SA tax year runs 1 March → end of February. Given the calendar year the
 * February falls in, return the [startDate, endDate] YYYY-MM-DD strings.
 */
export function getSaTaxYearRange(taxYearEndingIn: number): {
  start: string;
  end: string;
} {
  const startYear = taxYearEndingIn - 1;
  const start = `${startYear}-03-01`;
  // End of Feb — handle leap years
  const endYear = taxYearEndingIn;
  const isLeap = (endYear % 4 === 0 && endYear % 100 !== 0) || endYear % 400 === 0;
  const endDay = isLeap ? 29 : 28;
  const end = `${endYear}-02-${String(endDay).padStart(2, "0")}`;
  return { start, end };
}

/** True if the ISO date (YYYY-MM-DD) falls within the given SA tax year. */
export function isInTaxYear(isoDate: string, taxYearEndingIn: number): boolean {
  const { start, end } = getSaTaxYearRange(taxYearEndingIn);
  return isoDate >= start && isoDate <= end;
}

/** Return the last N tax years (calendar-year-ending-in), most recent first. */
export function getRecentTaxYears(referenceDate: Date, count = 5): number[] {
  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth() + 1; // 1..12
  // If we are on or after 1 March of year Y, year Y's tax year hasn't closed
  // yet — show Y as the "current" option. If we're in Jan/Feb of year Y, the
  // current (still open) tax year also ends in Y.
  const currentYearEnding = refMonth >= 3 ? refYear + 1 : refYear;
  const years: number[] = [];
  for (let i = 0; i < count; i += 1) {
    years.push(currentYearEnding - i);
  }
  return years;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Canonicalise a Transaction into its IT3 schedule line. Returns null if the
 * transaction should be excluded (e.g. zero-amount, or unrecognised type).
 *
 * Mapping rules:
 *   1. If category appears in IT3_SCHEDULE_MAP, use the mapped schedule/line.
 *      This takes precedence over tx.type — see Animal Purchases note above.
 *   2. Otherwise fall back to tx.type to decide income vs expense, and bucket
 *      into the "Other …" catch-all line.
 */
export function mapTransactionToLine(
  tx: TransactionLike,
): { schedule: It3ScheduleKey; line: string; code: string } | null {
  if (!tx || typeof tx.amount !== "number" || tx.amount === 0) return null;

  const mapped = IT3_SCHEDULE_MAP[tx.category];
  if (mapped) {
    // code is always "" — no per-line SARS codes exist on the ITR12
    return { schedule: mapped.schedule, line: mapped.line, code: "" };
  }

  if (tx.type === "income") {
    return { schedule: "income", line: IT3_OTHER_INCOME_LINE.line, code: "" };
  }
  if (tx.type === "expense") {
    return { schedule: "expense", line: IT3_OTHER_EXPENSE_LINE.line, code: "" };
  }
  return null;
}

export interface ComputeIt3Options {
  /**
   * The dominant livestock/farming species for this farm. Used to derive the
   * SARS ITR12 top-level farming activity code (e.g. "cattle" → 0104/0105).
   * If omitted or unknown, defaults to mixed farming (0102/0103).
   */
  dominantSpecies?: string | null;
  /**
   * Opening + closing stock at standard values (per First Schedule paragraph
   * 5(1) read with paragraph 2 + paragraph 3). When provided, the delta
   * (closing − opening) is added to netFarmingIncome.
   *
   * Caller is responsible for computing this via summariseStockMovement() in
   * lib/calculators/sars-stock.ts. Omitting it preserves the legacy
   * income−expenses behaviour for backward compatibility.
   *
   * Use the local type alias to avoid a circular import: the field is purely
   * a triple of numbers.
   */
  stockMovement?: {
    openingStockValueZar: number;
    closingStockValueZar: number;
    deltaZar: number;
  };
}

/**
 * Aggregate a list of transactions into SARS ITR12 farming schedule totals for
 * a given tax year. Transactions outside the tax year window are ignored so
 * callers don't need to pre-filter.
 *
 * Returns farmingActivityCode — the real SARS top-level activity code for the
 * ITR12, derived from dominantSpecies and sign of netFarmingIncome.
 */
export function computeIt3Schedules(
  transactions: TransactionLike[],
  taxYearEndingIn: number,
  options: ComputeIt3Options = {},
): It3ScheduleTotals {
  type Acc = Map<
    string,
    { line: string; code: string; amount: number; sources: Set<string>; count: number }
  >;

  const aggregate = (txs: TransactionLike[]) => {
    const incomeAcc: Acc = new Map();
    const expenseAcc: Acc = new Map();
    let totalIncome = 0;
    let totalExpenses = 0;
    let included = 0;

    for (const tx of txs) {
      if (!tx || typeof tx.date !== "string") continue;
      if (!isInTaxYear(tx.date, taxYearEndingIn)) continue;

      const mapped = mapTransactionToLine(tx);
      if (!mapped) continue;

      const amount = Math.abs(tx.amount);
      const bucket = mapped.schedule === "income" ? incomeAcc : expenseAcc;
      const existing = bucket.get(mapped.line);
      if (existing) {
        existing.amount += amount;
        existing.sources.add(tx.category);
        existing.count += 1;
      } else {
        bucket.set(mapped.line, {
          line: mapped.line,
          code: "",
          amount,
          sources: new Set([tx.category]),
          count: 1,
        });
      }

      if (mapped.schedule === "income") totalIncome += amount;
      else totalExpenses += amount;
      included += 1;
    }

    return { incomeAcc, expenseAcc, totalIncome, totalExpenses, included };
  };

  const toRows = (acc: Acc): It3ScheduleLineTotal[] =>
    [...acc.values()]
      .map((r) => ({
        line: r.line,
        code: r.code,
        amount: round2(r.amount),
        sourceCategories: [...r.sources].sort(),
        count: r.count,
      }))
      .sort((a, b) => a.line.localeCompare(b.line));

  // Split foreign-derived from domestic — they're parallel SARS reporting
  // lines (0192/0193 vs the domestic activity code).
  const { domestic, foreign } = splitTransactionsByForeignness(transactions);

  const dom = aggregate(domestic);

  const netBeforeStock = round2(dom.totalIncome - dom.totalExpenses);
  const stockDelta = options.stockMovement?.deltaZar ?? 0;
  const net = round2(netBeforeStock + stockDelta);
  const farmingActivityCode = getFarmingActivityCode({
    dominantSpecies: options.dominantSpecies,
    netResult: net >= 0 ? "profit" : "loss",
  });

  // Foreign block — only emit when at least one in-window foreign tx exists.
  let foreignFarmingIncome: It3ForeignFarmingIncome | null = null;
  if (foreign.length > 0) {
    const fx = aggregate(foreign);
    if (fx.included > 0) {
      const fxNet = round2(fx.totalIncome - fx.totalExpenses);
      foreignFarmingIncome = {
        income: toRows(fx.incomeAcc),
        expense: toRows(fx.expenseAcc),
        totalIncome: round2(fx.totalIncome),
        totalExpenses: round2(fx.totalExpenses),
        net: fxNet,
        activityCode: getFarmingActivityCode({
          dominantSpecies: "foreign",
          netResult: fxNet >= 0 ? "profit" : "loss",
        }),
      };
    }
  }

  const result: It3ScheduleTotals = {
    income: toRows(dom.incomeAcc),
    expense: toRows(dom.expenseAcc),
    totalIncome: round2(dom.totalIncome),
    totalExpenses: round2(dom.totalExpenses),
    netFarmingIncome: net,
    transactionCount: dom.included + (foreignFarmingIncome ? foreign.filter((t) => t && typeof t.date === "string" && isInTaxYear(t.date, taxYearEndingIn) && mapTransactionToLine(t)).length : 0),
    farmingActivityCode,
    foreignFarmingIncome,
  };

  if (options.stockMovement) {
    result.netFarmingIncomeBeforeStockMovement = netBeforeStock;
    result.openingStockValueZar = round2(options.stockMovement.openingStockValueZar);
    result.closingStockValueZar = round2(options.stockMovement.closingStockValueZar);
    result.stockMovementZar = round2(options.stockMovement.deltaZar);
  }

  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Formatting helpers (pure) ─────────────────────────────────────────────────

export function formatZar(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);
  // Group thousands with a regular ASCII space — en-ZA locale returns a
  // non-breaking space which breaks ASCII-comparison tests and CSV export.
  const wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}R ${wholeStr}.${String(cents).padStart(2, "0")}`;
}
