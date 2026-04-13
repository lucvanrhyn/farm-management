/**
 * lib/server/drought.ts — SPI-based drought payload for a farm.
 *
 * Combines farm-recorded RainfallRecord data (primary source) with
 * Open-Meteo ERA5 archive (fallback for months without farm records) to
 * produce the SPI-1, SPI-3, SPI-6, SPI-12 values and a 24-month history
 * used by the Drought Tools page and dashboard alerts.
 *
 * Algorithm overview:
 *  1. Fetch farm climatology (30-year normals) via getClimatologyForFarm.
 *  2. Aggregate farm RainfallRecord rows into monthly totals.
 *  3. For each of the last 24 completed months, prefer farm totals; fall back
 *     to Open-Meteo archive where no farm record exists (marked source:"archive").
 *  4. Compute per-month SPI-1 and rolling SPI-3 / SPI-6 / SPI-12.
 *  5. Compute YTD actuals vs YTD normals.
 */

import type { PrismaClient } from '@prisma/client';
import {
  calcSpi,
  severityFromSpi,
  aggregateMonthlyTotals,
  rollingWindowSum,
  computeClimatologyByMonth,
  type MonthClimatology,
  type SpiSeverity,
} from '@/lib/calculators/spi';
import { getClimatologyForFarm, fetchHistoricalRainfall } from '@/lib/server/open-meteo';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DroughtMonthRow {
  month: string;         // "YYYY-MM"
  actualMm: number;
  normalMm: number;
  spi: number;           // SPI-1 (single calendar month)
  severity: SpiSeverity;
  source: 'farm' | 'archive';
}

export interface SpiWindow {
  value: number;
  severity: SpiSeverity;
}

export interface DroughtPayload {
  monthly: DroughtMonthRow[];            // last 24 completed months, chronological
  current: {
    month: string;
    spi: number;
    severity: SpiSeverity;
  } | null;
  spi3:  SpiWindow | null;
  spi6:  SpiWindow | null;
  spi12: SpiWindow | null;
  ytdMm: number;
  ytdNormalMm: number;
  ytdPctOfNormal: number;                // 0..∞ (1.0 = on track)
  lastFarmObserved: string | null;       // ISO date of most recent RainfallRecord
  hasCoords: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return "YYYY-MM" string for N months before a given anchor month. */
function monthsBefore(anchor: string, n: number): string {
  const [y, m] = anchor.split('-').map(Number);
  let month = m - n;
  let year = y;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Return the "YYYY-MM" of the last completed calendar month. */
function lastCompletedMonth(): string {
  const d = new Date();
  d.setDate(1); // first of this month
  d.setMonth(d.getMonth() - 1); // roll back one month
  return d.toISOString().slice(0, 7);
}

/**
 * Compute summed climatology (mean + stdDev) for a rolling window of
 * calendar months ending at `anchor`. Used for multi-month SPI windows.
 *
 * The summed distribution of N independent normals has:
 *   mean_sum    = Σ mean_i
 *   stdDev_sum  = sqrt(Σ variance_i)  (assumes independence between months)
 */
function summedClimatology(
  climatology: Record<number, MonthClimatology>,
  anchor: string,
  windowMonths: number,
): MonthClimatology {
  const [anchorYear, anchorMonth] = anchor.split('-').map(Number);
  let meanSum = 0;
  let varianceSum = 0;

  for (let i = 0; i < windowMonths; i++) {
    let m = anchorMonth - i;
    let y = anchorYear;
    while (m <= 0) { m += 12; y -= 1; }
    const c = climatology[m] ?? { mean: 0, stdDev: 0 };
    meanSum += c.mean;
    varianceSum += c.stdDev ** 2;
  }

  return { mean: meanSum, stdDev: Math.sqrt(varianceSum) };
}

// ── getDroughtPayload ─────────────────────────────────────────────────────────

export async function getDroughtPayload(
  prisma: PrismaClient,
  lat: number | null,
  lng: number | null,
): Promise<DroughtPayload> {
  if (lat == null || lng == null) {
    return {
      monthly: [],
      current: null,
      spi3: null,
      spi6: null,
      spi12: null,
      ytdMm: 0,
      ytdNormalMm: 0,
      ytdPctOfNormal: 0,
      lastFarmObserved: null,
      hasCoords: false,
    };
  }

  // ── Step 1: fetch climatology (DB-cached, annual refresh) ─────────────────
  const climatology = await getClimatologyForFarm(prisma, lat, lng);

  // ── Step 2: aggregate farm RainfallRecord rows ────────────────────────────
  const farmRecords = await prisma.rainfallRecord.findMany({
    orderBy: { date: 'asc' },
    select: { date: true, rainfallMm: true },
  });

  const farmMonthly = aggregateMonthlyTotals(farmRecords);

  const lastFarmObserved =
    farmRecords.length > 0
      ? farmRecords[farmRecords.length - 1].date
      : null;

  // ── Step 3: build 24-month window ─────────────────────────────────────────
  const anchor = lastCompletedMonth();
  const months: string[] = [];
  for (let i = 23; i >= 0; i--) {
    months.push(monthsBefore(anchor, i));
  }

  // For archive fallback, fetch once for the span of the 24-month window
  // only if there are months not covered by farm records.
  const uncoveredMonths = months.filter((m) => !farmMonthly.has(m));
  let archiveMonthly = new Map<string, number>();

  if (uncoveredMonths.length > 0) {
    try {
      const oldestUncovered = uncoveredMonths[0]; // already sorted
      const newestUncovered = uncoveredMonths[uncoveredMonths.length - 1];
      const startYear = parseInt(oldestUncovered.slice(0, 4), 10);
      const endYear = parseInt(newestUncovered.slice(0, 4), 10);
      const archiveRecords = await fetchHistoricalRainfall(lat, lng, startYear, endYear);
      archiveMonthly = aggregateMonthlyTotals(
        archiveRecords.map((r) => ({ date: r.date, rainfallMm: r.precipMm })),
      );
    } catch {
      // Archive fetch failed — uncovered months will show as 0 with source:"archive"
    }
  }

  // Build a merged monthly map (farm wins over archive)
  const mergedMonthly = new Map<string, number>(archiveMonthly);
  for (const [k, v] of farmMonthly) {
    mergedMonthly.set(k, v);
  }

  // ── Step 4: build DroughtMonthRow[] ──────────────────────────────────────
  const monthly: DroughtMonthRow[] = months.map((month) => {
    const monthIdx = parseInt(month.slice(5, 7), 10);
    const clim = climatology[monthIdx] ?? { mean: 0, stdDev: 0 };
    const hasFarm = farmMonthly.has(month);
    const actualMm = mergedMonthly.get(month) ?? 0;
    const spi = calcSpi(actualMm, clim);

    return {
      month,
      actualMm,
      normalMm: clim.mean,
      spi,
      severity: severityFromSpi(spi),
      source: hasFarm ? 'farm' : 'archive',
    };
  });

  // ── Step 5: multi-month SPI windows (using merged data) ───────────────────
  const buildWindow = (windowMonths: number): SpiWindow | null => {
    if (months.length < windowMonths) return null;
    const sum = rollingWindowSum(mergedMonthly, anchor, windowMonths);
    const c = summedClimatology(climatology, anchor, windowMonths);
    const spiVal = calcSpi(sum, c);
    return { value: parseFloat(spiVal.toFixed(2)), severity: severityFromSpi(spiVal) };
  };

  const spi3  = buildWindow(3);
  const spi6  = buildWindow(6);
  const spi12 = buildWindow(12);

  // ── Step 6: current month SPI (last entry in monthly array) ───────────────
  const lastRow = monthly[monthly.length - 1] ?? null;
  const current = lastRow
    ? { month: lastRow.month, spi: parseFloat(lastRow.spi.toFixed(2)), severity: lastRow.severity }
    : null;

  // ── Step 7: YTD stats ──────────────────────────────────────────────────────
  const anchorYear = parseInt(anchor.slice(0, 4), 10);
  const anchorMonth = parseInt(anchor.slice(5, 7), 10);
  let ytdMm = 0;
  let ytdNormalMm = 0;
  for (let m = 1; m <= anchorMonth; m++) {
    const key = `${anchorYear}-${String(m).padStart(2, '0')}`;
    ytdMm += mergedMonthly.get(key) ?? 0;
    ytdNormalMm += (climatology[m] ?? { mean: 0 }).mean;
  }
  const ytdPctOfNormal = ytdNormalMm > 0 ? ytdMm / ytdNormalMm : 0;

  return {
    monthly,
    current,
    spi3,
    spi6,
    spi12,
    ytdMm: parseFloat(ytdMm.toFixed(1)),
    ytdNormalMm: parseFloat(ytdNormalMm.toFixed(1)),
    ytdPctOfNormal: parseFloat(ytdPctOfNormal.toFixed(3)),
    lastFarmObserved,
    hasCoords: true,
  };
}
