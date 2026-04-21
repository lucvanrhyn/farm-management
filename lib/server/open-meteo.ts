/**
 * Open-Meteo Archive API client + farm climatology cache.
 *
 * Open-Meteo Archive provides ERA5 reanalysis data from 1940 to the recent
 * past (free, no API key, 0.25° resolution). We use it to derive the
 * long-term monthly rainfall normals that SPI requires.
 *
 * Climatology strategy:
 *  1. Primary cache: 12 RainfallNormal rows per (lat, lng) in the farm DB,
 *     refreshed when the rows are >365 days old.
 *  2. Module-level Map: prevents redundant DB + archive fetches within a
 *     single request lifecycle (avoids multiple concurrent page segments
 *     each fetching the same data).
 *
 * URL pattern mirrors WeatherWidget.tsx lines 148-155 (same Open-Meteo,
 * different endpoint and parameter set).
 */

import type { PrismaClient } from '@prisma/client';
import {
  computeClimatologyByMonth,
  type MonthClimatology,
} from '@/lib/calculators/spi';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DailyRainfallRecord {
  date: string;    // "YYYY-MM-DD"
  precipMm: number;
}

// ── Module-level request cache ────────────────────────────────────────────────

// Key: "lat:lng" — value: promise so concurrent callers await the same fetch
const _inFlightClimatology = new Map<string, Promise<Record<number, MonthClimatology>>>();

// ── fetchHistoricalRainfall ───────────────────────────────────────────────────

/**
 * Fetch daily precipitation totals from Open-Meteo ERA5 Archive.
 *
 * @param lat       - Decimal latitude
 * @param lng       - Decimal longitude
 * @param startYear - First year of the desired period (inclusive)
 * @param endYear   - Last year of the desired period (inclusive)
 * @throws          - If the API returns an error response
 */
export async function fetchHistoricalRainfall(
  lat: number,
  lng: number,
  startYear: number,
  endYear: number,
): Promise<DailyRainfallRecord[]> {
  const startDate = `${startYear}-01-01`;
  const endDate = `${endYear}-12-31`;
  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lng}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=precipitation_sum` +
    `&timezone=Africa%2FJohannesburg`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(
      `Open-Meteo Archive error ${res.status} for (${lat}, ${lng}) ${startYear}–${endYear}`,
    );
  }

  const json = (await res.json()) as {
    daily?: { time: string[]; precipitation_sum: (number | null)[] };
    error?: boolean;
    reason?: string;
  };

  if (json.error) {
    throw new Error(`Open-Meteo Archive returned error: ${json.reason ?? 'unknown'}`);
  }

  const times = json.daily?.time ?? [];
  const sums = json.daily?.precipitation_sum ?? [];

  return times.map((date, i) => ({
    date,
    precipMm: sums[i] ?? 0, // null values (missing data) treated as 0
  }));
}

// ── getClimatologyForFarm ─────────────────────────────────────────────────────

/**
 * Return the 30-year monthly rainfall climatology (mean + stdDev) for a
 * farm's location, using the farm DB as a persistent cache.
 *
 * Cache policy:
 *  - If 12 rows exist for (lat, lng) and the oldest `computedAt` is < 365
 *    days ago → return cached values (no network call).
 *  - Otherwise → fetch ERA5 archive for the past 30 completed years,
 *    compute climatology, upsert 12 rows.
 *
 * @returns Record keyed 1..12 with { mean, stdDev } per calendar month.
 */
export async function getClimatologyForFarm(
  prisma: PrismaClient,
  lat: number,
  lng: number,
): Promise<Record<number, MonthClimatology>> {
  const key = `${lat.toFixed(4)}:${lng.toFixed(4)}`;

  // Deduplicate concurrent calls within the same module lifetime
  const inflight = _inFlightClimatology.get(key);
  if (inflight) return inflight;

  const promise = _fetchOrComputeClimatology(prisma, lat, lng);
  _inFlightClimatology.set(key, promise);

  try {
    return await promise;
  } finally {
    // Clear so the next request lifecycle re-checks the DB (don't cache stale
    // results across cold-start boundaries)
    _inFlightClimatology.delete(key);
  }
}

async function _fetchOrComputeClimatology(
  prisma: PrismaClient,
  lat: number,
  lng: number,
): Promise<Record<number, MonthClimatology>> {
  // Step 1: check DB cache
  const existing = await prisma.rainfallNormal.findMany({
    where: { latitude: lat, longitude: lng },
    orderBy: { computedAt: 'asc' },
  });

  if (existing.length === 12) {
    const ageMs = Date.now() - existing[0].computedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 365) {
      // Cache is fresh — return without fetching archive
      return _rowsToRecord(existing);
    }
  }

  // Step 2: fetch 30 years of ERA5 archive
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 30;
  const endYear = currentYear - 1;

  const history = await fetchHistoricalRainfall(lat, lng, startYear, endYear);
  const climatology = computeClimatologyByMonth(history);

  // Step 3: upsert 12 rows (one per calendar month)
  const now = new Date();
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => i + 1).map((monthIdx) => {
      const c = climatology[monthIdx];
      return prisma.rainfallNormal.upsert({
        where: {
          rain_norm_latlng_month: {
            latitude: lat,
            longitude: lng,
            monthIdx,
          },
        },
        update: {
          meanMm: c.mean,
          stdDevMm: c.stdDev,
          sampleYears: endYear - startYear + 1,
          computedAt: now,
        },
        create: {
          latitude: lat,
          longitude: lng,
          monthIdx,
          meanMm: c.mean,
          stdDevMm: c.stdDev,
          sampleYears: endYear - startYear + 1,
          computedAt: now,
        },
      });
    }),
  );

  return climatology;
}

function _rowsToRecord(
  rows: Array<{ monthIdx: number; meanMm: number; stdDevMm: number }>,
): Record<number, MonthClimatology> {
  const result: Record<number, MonthClimatology> = {} as Record<number, MonthClimatology>;
  // Ensure all 12 months are present even if DB is sparse
  for (let m = 1; m <= 12; m++) {
    result[m] = { mean: 0, stdDev: 0 };
  }
  for (const row of rows) {
    result[row.monthIdx] = { mean: row.meanMm, stdDev: row.stdDevMm };
  }
  return result;
}
