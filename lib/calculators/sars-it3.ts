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
  /** SARS source code — historical ITR12 farming schedule code. Advisory. */
  code: string;
}

export interface It3MappedCategory extends It3Line {
  schedule: It3ScheduleKey;
  /** The FarmTrack `Transaction.category` this line maps from. */
  sourceCategory: string;
}

export interface TransactionLike {
  type: string;              // "income" | "expense"
  category: string;          // maps onto IT3 line
  amount: number;            // Rand, always positive
  date: string;              // YYYY-MM-DD (SA locale)
  description?: string | null;
}

export interface It3ScheduleLineTotal {
  line: string;
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
  netFarmingIncome: number;
  transactionCount: number;
}

// ── SARS IT3 schedule map ─────────────────────────────────────────────────────
//
// Maps FarmTrack default category names onto SARS farming schedule lines.
// Keys are case-sensitive and must match lib/constants/default-categories.ts
// exactly. Unmapped categories fall through to the "Other" buckets below.
//
// Codes below are from the ITR12 "Farming Operations" schedule (historical,
// advisory only — SARS may reshuffle line numbers between tax years).

export const IT3_SCHEDULE_MAP: Record<string, It3MappedCategory> = {
  // ─ Income lines ─
  "Animal Sales": {
    schedule: "income",
    line: "Sales of livestock",
    code: "4101",
    sourceCategory: "Animal Sales",
  },
  "Livestock Production": {
    schedule: "income",
    line: "Livestock production and other farming income",
    code: "4102",
    sourceCategory: "Livestock Production",
  },
  "Subsidies": {
    schedule: "income",
    line: "Government subsidies and rebates",
    code: "4103",
    sourceCategory: "Subsidies",
  },

  // ─ Expense lines ─
  // NOTE: "Animal Purchases" is categorised by the shipped defaults as
  // `type: "income"` (a historical quirk in default-categories.ts), but
  // economically it is a cost of sales line. We remap it to the expense
  // schedule here so the IT3 totals reflect economic reality.
  "Animal Purchases": {
    schedule: "expense",
    line: "Livestock purchases (cost of sales)",
    code: "4201",
    sourceCategory: "Animal Purchases",
  },
  "Feed/Supplements": {
    schedule: "expense",
    line: "Feed and supplements",
    code: "4202",
    sourceCategory: "Feed/Supplements",
  },
  "Medication/Vet": {
    schedule: "expense",
    line: "Veterinary services and medicine",
    code: "4203",
    sourceCategory: "Medication/Vet",
  },
  "Labour": {
    schedule: "expense",
    line: "Wages and salaries",
    code: "4204",
    sourceCategory: "Labour",
  },
  "Fuel/Transport": {
    schedule: "expense",
    line: "Fuel and transport",
    code: "4205",
    sourceCategory: "Fuel/Transport",
  },
  "Equipment/Repairs": {
    schedule: "expense",
    line: "Repairs and maintenance",
    code: "4206",
    sourceCategory: "Equipment/Repairs",
  },
  "Camp Maintenance": {
    schedule: "expense",
    line: "Camp and land maintenance",
    code: "4207",
    sourceCategory: "Camp Maintenance",
  },
};

export const IT3_OTHER_INCOME_LINE: It3Line = {
  line: "Other farming income",
  code: "4199",
};

export const IT3_OTHER_EXPENSE_LINE: It3Line = {
  line: "Other farming expenses",
  code: "4299",
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
    return { schedule: mapped.schedule, line: mapped.line, code: mapped.code };
  }

  if (tx.type === "income") {
    return { schedule: "income", line: IT3_OTHER_INCOME_LINE.line, code: IT3_OTHER_INCOME_LINE.code };
  }
  if (tx.type === "expense") {
    return { schedule: "expense", line: IT3_OTHER_EXPENSE_LINE.line, code: IT3_OTHER_EXPENSE_LINE.code };
  }
  return null;
}

/**
 * Aggregate a list of transactions into SARS IT3 schedule totals for a given
 * tax year. Transactions outside the tax year window are ignored so callers
 * don't need to pre-filter.
 */
export function computeIt3Schedules(
  transactions: TransactionLike[],
  taxYearEndingIn: number,
): It3ScheduleTotals {
  const incomeAcc = new Map<
    string,
    { line: string; code: string; amount: number; sources: Set<string>; count: number }
  >();
  const expenseAcc = new Map<
    string,
    { line: string; code: string; amount: number; sources: Set<string>; count: number }
  >();

  let totalIncome = 0;
  let totalExpenses = 0;
  let included = 0;

  for (const tx of transactions) {
    if (!tx || typeof tx.date !== "string") continue;
    if (!isInTaxYear(tx.date, taxYearEndingIn)) continue;

    const mapped = mapTransactionToLine(tx);
    if (!mapped) continue;

    const amount = Math.abs(tx.amount);
    const bucket = mapped.schedule === "income" ? incomeAcc : expenseAcc;
    const existing = bucket.get(mapped.code);
    if (existing) {
      existing.amount += amount;
      existing.sources.add(tx.category);
      existing.count += 1;
    } else {
      bucket.set(mapped.code, {
        line: mapped.line,
        code: mapped.code,
        amount,
        sources: new Set([tx.category]),
        count: 1,
      });
    }

    if (mapped.schedule === "income") totalIncome += amount;
    else totalExpenses += amount;
    included += 1;
  }

  const toRows = (
    acc: Map<string, { line: string; code: string; amount: number; sources: Set<string>; count: number }>,
  ): It3ScheduleLineTotal[] =>
    [...acc.values()]
      .map((r) => ({
        line: r.line,
        code: r.code,
        amount: round2(r.amount),
        sourceCategories: [...r.sources].sort(),
        count: r.count,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

  return {
    income: toRows(incomeAcc),
    expense: toRows(expenseAcc),
    totalIncome: round2(totalIncome),
    totalExpenses: round2(totalExpenses),
    netFarmingIncome: round2(totalIncome - totalExpenses),
    transactionCount: included,
  };
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
