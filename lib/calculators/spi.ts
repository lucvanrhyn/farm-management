/**
 * Standard Precipitation Index (SPI) calculator — pure functions, no side effects.
 *
 * SPI is the WMO-standard meteorological drought metric. It expresses monthly
 * rainfall as a standardised anomaly relative to the long-term climatological
 * normal for that calendar month.
 *
 * METHOD: Z-score (v1)
 *   SPI = (observed − mean) / stdDev
 *
 * A proper implementation would use a gamma-distribution fit to handle the
 * skewed distribution of monthly rainfall. The Z-score approach is used here
 * because (a) it is transparent to farmers, (b) it is adequate for
 * decision-support in SA semi-arid contexts, and (c) gamma fitting requires a
 * minimum of ~30 years of data that is not always available. A gamma upgrade
 * is an explicit Phase 9 stretch goal.
 *
 * WMO SEVERITY THRESHOLDS (SPI 2012 guidelines):
 *   ≤ −2.00  extreme drought
 *   ≤ −1.50  severe drought
 *   ≤ −1.00  moderate drought
 *   ≤ −0.50  mild dry
 *   (−0.50, 0.50) near normal
 *   ≥  0.50  mild wet
 *   ≥  1.00  moderate wet
 *   ≥  1.50  severe wet
 *   ≥  2.00  extreme wet
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MonthClimatology {
  /** Mean monthly rainfall in mm over the reference period. */
  readonly mean: number;
  /** Population standard deviation in mm over the reference period. */
  readonly stdDev: number;
}

export type SpiSeverity =
  | 'extreme-drought'
  | 'severe-drought'
  | 'moderate-drought'
  | 'mild-dry'
  | 'near-normal'
  | 'mild-wet'
  | 'moderate-wet'
  | 'severe-wet'
  | 'extreme-wet';

// ── calcSpi ───────────────────────────────────────────────────────────────────

/**
 * Compute SPI for a single month.
 *
 * Returns 0 when stdDev is 0 (degenerate climatology — all months identical).
 */
export function calcSpi(
  monthRainfallMm: number,
  c: MonthClimatology,
): number {
  if (c.stdDev === 0) return 0;
  return (monthRainfallMm - c.mean) / c.stdDev;
}

// ── severityFromSpi ───────────────────────────────────────────────────────────

/**
 * Map an SPI value to a WMO drought / wet severity category.
 * Boundaries are inclusive on the drought/wet side (≤ / ≥).
 */
export function severityFromSpi(spi: number): SpiSeverity {
  if (spi <= -2.0) return 'extreme-drought';
  if (spi <= -1.5) return 'severe-drought';
  if (spi <= -1.0) return 'moderate-drought';
  if (spi <= -0.5) return 'mild-dry';
  if (spi < 0.5)   return 'near-normal';
  if (spi < 1.0)   return 'mild-wet';
  if (spi < 1.5)   return 'moderate-wet';
  if (spi < 2.0)   return 'severe-wet';
  return 'extreme-wet';
}

// ── aggregateMonthlyTotals ────────────────────────────────────────────────────

/**
 * Sum daily (or periodic) rainfall records into a monthly total Map.
 *
 * @param records - Array of records with ISO date strings (YYYY-MM-DD or YYYY-MM)
 *                  and rainfall amounts.
 * @returns Map from "YYYY-MM" keys to total rainfall in mm.
 */
export function aggregateMonthlyTotals(
  records: readonly { date: string; rainfallMm: number }[],
): Map<string, number> {
  const monthly = new Map<string, number>();
  for (const r of records) {
    // Accept both "YYYY-MM-DD" and "YYYY-MM" formats
    const key = r.date.slice(0, 7); // "YYYY-MM"
    monthly.set(key, (monthly.get(key) ?? 0) + r.rainfallMm);
  }
  return monthly;
}

// ── rollingWindowSum ──────────────────────────────────────────────────────────

/**
 * Sum monthly rainfall over a rolling window ending at `anchor` (inclusive).
 *
 * Used to compute multi-month SPI windows (SPI-3, SPI-6, SPI-12).
 * Missing months are treated as 0 mm (no record = no rain assumed, allowing
 * SPI to be computed without requiring complete data).
 *
 * @param monthly      - Map from "YYYY-MM" to total mm (from aggregateMonthlyTotals)
 * @param anchor       - The last month in the window, "YYYY-MM"
 * @param windowMonths - Number of months to include (1 = current month only)
 */
export function rollingWindowSum(
  monthly: Map<string, number>,
  anchor: string,
  windowMonths: number,
): number {
  let total = 0;
  const [anchorYear, anchorMonth] = anchor.split('-').map(Number);

  for (let i = 0; i < windowMonths; i++) {
    // Step back i months from anchor
    let month = anchorMonth - i;
    let year = anchorYear;
    while (month <= 0) {
      month += 12;
      year -= 1;
    }
    const key = `${year}-${String(month).padStart(2, '0')}`;
    total += monthly.get(key) ?? 0;
  }

  return total;
}

// ── computeClimatologyByMonth ─────────────────────────────────────────────────

/**
 * Derive monthly climatology normals from a historical time series.
 *
 * Groups records by calendar month (1–12), computes mean and population
 * standard deviation for each group.
 *
 * @param history - Array of daily or monthly records with precipMm values
 *                  and ISO date strings. Records with the same YYYY-MM are
 *                  summed before being included in the monthly population.
 * @returns Record keyed 1–12 with { mean, stdDev } for each calendar month.
 *          Months with no data receive { mean: 0, stdDev: 0 }.
 */
export function computeClimatologyByMonth(
  history: readonly { date: string; precipMm: number }[],
): Record<number, MonthClimatology> {
  // Step 1: aggregate to monthly totals (per year-month)
  const asRainfallRecords = history.map((r) => ({
    date: r.date,
    rainfallMm: r.precipMm,
  }));
  const monthly = aggregateMonthlyTotals(asRainfallRecords);

  // Step 2: bucket by calendar month index (1–12)
  const buckets: Map<number, number[]> = new Map();
  for (let m = 1; m <= 12; m++) {
    buckets.set(m, []);
  }
  for (const [key, total] of monthly) {
    const monthIdx = parseInt(key.slice(5, 7), 10); // "YYYY-MM" → MM
    buckets.get(monthIdx)!.push(total);
  }

  // Step 3: compute mean + population stdDev per calendar month
  const result: Record<number, MonthClimatology> = {} as Record<
    number,
    MonthClimatology
  >;
  for (let m = 1; m <= 12; m++) {
    const values = buckets.get(m)!;
    if (values.length === 0) {
      result[m] = { mean: 0, stdDev: 0 };
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    result[m] = { mean, stdDev: Math.sqrt(variance) };
  }

  return result;
}
