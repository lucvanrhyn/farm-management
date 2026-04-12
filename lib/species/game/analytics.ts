// lib/species/game/analytics.ts — Game species analytics helpers
// All queries use $queryRawUnsafe because game tables are not in the Prisma schema.

import type { PrismaClient } from "@prisma/client";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CensusSpeciesRow {
  speciesId: string;
  commonName: string;
  totalCount: number;
  maleCount: number;
  femaleCount: number;
  juvenileCount: number;
}

export interface LatestCensusData {
  latestCensusDate: string | null;
  totalPopulation: number;
  bySpecies: Record<string, CensusSpeciesRow>;
}

export interface QuotaUtilizationRow {
  speciesId: string;
  totalQuota: number;
  usedTotal: number;
  utilizationPct: number;
  atRisk: boolean;
}

export interface OverdueCensusRow {
  speciesId: string;
  commonName: string;
  daysSinceLastCensus: number | null;
}

// ── Raw DB row shapes (from $queryRawUnsafe) ────────────────────────────────

interface RawCensusEvent {
  id: string;
  date: string;
}

interface RawCensusResult {
  speciesId: string;
  commonName: string | null;
  totalCount: bigint | number;
  maleCount: bigint | number | null;
  femaleCount: bigint | number | null;
  juvenileCount: bigint | number | null;
}

interface RawQuotaRow {
  speciesId: string;
  totalQuota: bigint | number;
  usedTotal: bigint | number;
}

interface RawOverdueRow {
  speciesId: string;
  commonName: string;
  lastCensusDate: string | null;
  daysSince: bigint | number | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toNum(v: bigint | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : v;
}

// ── Analytics Functions ─────────────────────────────────────────────────────

/**
 * Returns the most recent census event date and per-species population totals.
 */
export async function getLatestCensusData(
  prisma: PrismaClient,
): Promise<LatestCensusData> {
  const eventRows = await prisma.$queryRawUnsafe<RawCensusEvent[]>(
    `SELECT id, date FROM GameCensusEvent ORDER BY date DESC LIMIT 1`,
  );

  if (eventRows.length === 0) {
    return { latestCensusDate: null, totalPopulation: 0, bySpecies: {} };
  }

  const latestEvent = eventRows[0];

  const resultRows = await prisma.$queryRawUnsafe<RawCensusResult[]>(
    `SELECT r.speciesId, s.commonName, r.totalCount, r.maleCount, r.femaleCount, r.juvenileCount
     FROM GameCensusResult r
     LEFT JOIN GameSpecies s ON s.id = r.speciesId
     WHERE r.censusEventId = ?`,
    latestEvent.id,
  );

  let totalPopulation = 0;
  const bySpecies: Record<string, CensusSpeciesRow> = {};

  for (const row of resultRows) {
    const total = toNum(row.totalCount);
    totalPopulation += total;
    bySpecies[row.speciesId] = {
      speciesId: row.speciesId,
      commonName: row.commonName ?? row.speciesId,
      totalCount: total,
      maleCount: toNum(row.maleCount),
      femaleCount: toNum(row.femaleCount),
      juvenileCount: toNum(row.juvenileCount),
    };
  }

  return { latestCensusDate: latestEvent.date, totalPopulation, bySpecies };
}

/**
 * Returns per-species quota utilization for the given season.
 * atRisk = usedTotal / totalQuota > 0.8
 */
export async function getQuotaUtilization(
  prisma: PrismaClient,
  currentSeason: string,
): Promise<QuotaUtilizationRow[]> {
  const rows = await prisma.$queryRawUnsafe<RawQuotaRow[]>(
    `SELECT speciesId, totalQuota, usedTotal
     FROM GameOfftakeQuota
     WHERE season = ? AND totalQuota > 0`,
    currentSeason,
  );

  return rows.map((row) => {
    const totalQuota = toNum(row.totalQuota);
    const usedTotal = toNum(row.usedTotal);
    const utilizationPct = totalQuota > 0 ? usedTotal / totalQuota : 0;
    return {
      speciesId: row.speciesId,
      totalQuota,
      usedTotal,
      utilizationPct,
      atRisk: utilizationPct > 0.8,
    };
  });
}

/**
 * Returns species that have not had a census in the last 365 days,
 * or have never been censused.
 */
export async function getSpeciesWithOverdueCensus(
  prisma: PrismaClient,
): Promise<OverdueCensusRow[]> {
  const rows = await prisma.$queryRawUnsafe<RawOverdueRow[]>(
    `SELECT s.id as speciesId, s.commonName,
            MAX(e.date) as lastCensusDate,
            CAST((julianday('now') - julianday(MAX(e.date))) AS INTEGER) as daysSince
     FROM GameSpecies s
     LEFT JOIN GameCensusResult r ON r.speciesId = s.id
     LEFT JOIN GameCensusEvent e ON e.id = r.censusEventId
     GROUP BY s.id, s.commonName
     HAVING lastCensusDate IS NULL OR daysSince > 365`,
  );

  return rows.map((row) => ({
    speciesId: row.speciesId,
    commonName: row.commonName,
    daysSinceLastCensus: row.daysSince != null ? toNum(row.daysSince) : null,
  }));
}

// ── Census Population by Camp ──────────────────────────────────────────────

export interface CensusPopulationByCamp {
  campId: string;
  totalPopulation: number;
}

/**
 * Returns total game population per camp from the most recent census event.
 * Only includes census results that have a campId assigned.
 */
export async function getCensusPopulationByCamp(
  prisma: PrismaClient,
): Promise<CensusPopulationByCamp[]> {
  const eventRows = await prisma.$queryRawUnsafe<RawCensusEvent[]>(
    `SELECT id FROM GameCensusEvent ORDER BY date DESC LIMIT 1`,
  );

  if (eventRows.length === 0) return [];

  const rows = await prisma.$queryRawUnsafe<
    Array<{ campId: string; totalPop: bigint | number }>
  >(
    `SELECT campId, SUM(totalCount) as totalPop
     FROM GameCensusResult
     WHERE censusEventId = ? AND campId IS NOT NULL
     GROUP BY campId`,
    eventRows[0].id,
  );

  return rows.map((r) => ({
    campId: r.campId,
    totalPopulation: toNum(r.totalPop),
  }));
}

/**
 * Calculates the maximum sustainable offtake count for a species.
 *
 * NetGrowthRate = recruitmentRate - mortalityRate - (predationLosses / currentPopulation)
 * MaxOfftake    = NetGrowthRate * currentPopulation * 0.75
 */
export function calcMaxSustainableOfftake(
  currentPopulation: number,
  recruitmentRate: number,
  mortalityRate: number,
  predationLosses: number,
): number {
  if (currentPopulation <= 0) return 0;
  const predationRate = predationLosses / currentPopulation;
  const netGrowthRate = recruitmentRate - mortalityRate - predationRate;
  if (netGrowthRate <= 0) return 0;
  return Math.floor(netGrowthRate * currentPopulation * 0.75);
}
