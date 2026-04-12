// lib/species/game/index.ts — Game species module (full Phase 4 implementation)
// All game DB queries use $queryRawUnsafe — game tables are not in Prisma schema.

import type { PrismaClient } from "@prisma/client";
import type {
  SpeciesModule,
  SpeciesDashboardData,
  SpeciesReproStats,
  SpeciesAlert,
} from "../types";
import { GAME_CONFIG } from "./config";
import {
  getLatestCensusData,
  getQuotaUtilization,
  getSpeciesWithOverdueCensus,
} from "./analytics";

export { GAME_CONFIG } from "./config";

// ── Raw DB row types ─────────────────────────────────────────────────────────

interface RawSpeciesRow {
  id: string;
  commonName: string;
  currentEstimate: bigint | number | null;
}

interface RawCountRow {
  count: bigint | number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: bigint | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : v;
}

function currentSeasonYear(): string {
  return String(new Date().getFullYear());
}

// ── Dashboard Data ───────────────────────────────────────────────────────────

async function getDashboardData(
  prisma: PrismaClient,
): Promise<SpeciesDashboardData> {
  const [speciesRows, censusData] = await Promise.all([
    prisma.$queryRawUnsafe<RawSpeciesRow[]>(
      `SELECT id, commonName, currentEstimate FROM GameSpecies`,
    ),
    getLatestCensusData(prisma),
  ]);

  const byCategory: Record<string, number> = {};
  let totalCount = 0;

  for (const row of speciesRows) {
    const estimate = toNum(row.currentEstimate);
    byCategory[row.commonName] = estimate;
    totalCount += estimate;
  }

  return {
    totalCount,
    activeCount: totalCount,
    byCategory,
    byCamp: {}, // Game is managed at property level, not per camp
    reproStats: null,
    speciesSpecific: {
      latestCensusDate: censusData.latestCensusDate,
      totalEstimatedPopulation: totalCount,
      speciesCount: speciesRows.length,
    },
  };
}

// ── Repro Stats ──────────────────────────────────────────────────────────────

async function getReproStats(
  _prisma: PrismaClient,
): Promise<SpeciesReproStats> {
  // Game does not track individual reproduction events
  return {
    pregnancyRate: null,
    birthRate: null,
    avgBirthIntervalDays: null,
    upcomingBirths: [],
  };
}

// ── Alert Builders ────────────────────────────────────────────────────────────

async function buildPermitAlert(
  prisma: PrismaClient,
  farmSlug: string,
): Promise<SpeciesAlert | null> {
  const soonRows = await prisma.$queryRawUnsafe<RawCountRow[]>(
    `SELECT COUNT(*) as count FROM GamePermit
     WHERE status = 'active' AND expiryDate <= date('now', '+30 days')`,
  );
  const totalSoon = toNum(soonRows[0]?.count);
  if (totalSoon === 0) return null;

  const urgentRows = await prisma.$queryRawUnsafe<RawCountRow[]>(
    `SELECT COUNT(*) as count FROM GamePermit
     WHERE status = 'active' AND expiryDate <= date('now', '+7 days')`,
  );
  const urgent = toNum(urgentRows[0]?.count);

  return {
    id: "game-permit-expiry",
    severity: urgent > 0 ? "red" : "amber",
    icon: "FileWarning",
    message:
      urgent > 0
        ? `${urgent} permit${urgent === 1 ? "" : "s"} expiring within 7 days`
        : `${totalSoon} permit${totalSoon === 1 ? "" : "s"} expiring within 30 days`,
    count: urgent > 0 ? urgent : totalSoon,
    href: `/${farmSlug}/game/permits`,
  };
}

async function buildQuotaAlert(
  prisma: PrismaClient,
  farmSlug: string,
): Promise<SpeciesAlert | null> {
  const quotas = await getQuotaUtilization(prisma, currentSeasonYear());
  const atRisk = quotas.filter((q) => q.atRisk);
  if (atRisk.length === 0) return null;

  return {
    id: "game-quota-near-limit",
    severity: "amber",
    icon: "AlertTriangle",
    message: `${atRisk.length} species ${atRisk.length === 1 ? "is" : "are"} above 80% quota utilisation`,
    count: atRisk.length,
    href: `/${farmSlug}/game/quotas`,
  };
}

async function buildCensusOverdueAlert(
  prisma: PrismaClient,
  farmSlug: string,
): Promise<SpeciesAlert | null> {
  const overdue = await getSpeciesWithOverdueCensus(prisma);
  if (overdue.length === 0) return null;

  return {
    id: "game-census-overdue",
    severity: "amber",
    icon: "ClipboardX",
    message: `${overdue.length} species ${overdue.length === 1 ? "has" : "have"} no census in the last 12 months`,
    count: overdue.length,
    href: `/${farmSlug}/game/census`,
  };
}

async function buildPredationAlert(
  prisma: PrismaClient,
  farmSlug: string,
): Promise<SpeciesAlert | null> {
  const rows = await prisma.$queryRawUnsafe<RawCountRow[]>(
    `SELECT COUNT(*) as count FROM GamePredationEvent
     WHERE date >= date('now', '-30 days')`,
  );
  const count = toNum(rows[0]?.count);
  if (count === 0) return null;

  return {
    id: "game-predation-recent",
    severity: "amber",
    icon: "AlertOctagon",
    message: `${count} predation event${count === 1 ? "" : "s"} recorded in the last 30 days`,
    count,
    href: `/${farmSlug}/game/predation`,
  };
}

async function buildWaterPointAlert(
  prisma: PrismaClient,
  farmSlug: string,
): Promise<SpeciesAlert | null> {
  const rows = await prisma.$queryRawUnsafe<RawCountRow[]>(
    `SELECT COUNT(*) as count FROM GameWaterPoint WHERE status != 'operational'`,
  );
  const count = toNum(rows[0]?.count);
  if (count === 0) return null;

  return {
    id: "game-water-point-issue",
    severity: "amber",
    icon: "Droplets",
    message: `${count} water point${count === 1 ? "" : "s"} not operational`,
    count,
    href: `/${farmSlug}/game/infrastructure`,
  };
}

// ── Alerts Orchestrator ───────────────────────────────────────────────────────

async function getAlerts(
  prisma: PrismaClient,
  farmSlug: string,
  _thresholds: Record<string, number>,
): Promise<SpeciesAlert[]> {
  const settled = await Promise.allSettled([
    buildPermitAlert(prisma, farmSlug),
    buildQuotaAlert(prisma, farmSlug),
    buildCensusOverdueAlert(prisma, farmSlug),
    buildPredationAlert(prisma, farmSlug),
    buildWaterPointAlert(prisma, farmSlug),
  ]);

  const alerts: SpeciesAlert[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value !== null) {
      alerts.push(result.value);
    }
  }
  return alerts;
}

// ── Module Export ─────────────────────────────────────────────────────────────

export const gameModule: SpeciesModule = {
  config: GAME_CONFIG,

  getDashboardData,
  getReproStats,
  getAlerts,

  getLsuValues(farmOverrides?: Record<string, number>): Record<string, number> {
    // GAME_CONFIG.defaultLsuValues is the compile-time fallback.
    // Real per-species LSU values live in GameSpecies.lsuEquivalent (fetched async).
    return { ...GAME_CONFIG.defaultLsuValues, ...farmOverrides };
  },

  validateCategory(_category: string): boolean {
    // Game uses species names as categories — all are valid at this layer.
    return true;
  },

  validateObservationType(_type: string): boolean {
    // Game observation types are open-ended at population level.
    return true;
  },
};
