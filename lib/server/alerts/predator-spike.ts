// lib/server/alerts/predator-spike.ts — PREDATOR_SPIKE (realtime, never suppressed).
//
// Research brief §D row 4: 7-day rolling mean μ + 2σ of predator-loss events
// per day. Fires when today's count > μ + 2σ AND today's count ≥ 2.
//
// Data sources (union): GamePredationEvent rows + Observation rows with type
// "predation_loss" (sheep-specific) + death observations with predator cause.
// We just count events per day for the last 14 days and apply stats.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, toIsoDate } from "./helpers";

const LOOKBACK_DAYS = 14;
const MIN_TODAY_COUNT = 2;
const SIGMA_MULTIPLIER = 2;

interface PredationRow {
  date: string;
  count: number;
}

/** Public so the dispatcher can detect "predator alert" without string matching. */
export const PREDATOR_SPIKE_TYPE = "PREDATOR_SPIKE";

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], mu: number): number {
  if (values.length === 0) return 0;
  const variance =
    values.reduce((acc, v) => acc + (v - mu) * (v - mu), 0) / values.length;
  return Math.sqrt(variance);
}

export async function evaluate(
  prisma: PrismaClient,
  _settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  const todayIso = toIsoDate(new Date());
  const lookbackIso = toIsoDate(
    new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
  );

  // Aggregate per-day counts from GamePredationEvent.
  let gameRows: PredationRow[] = [];
  try {
    gameRows = await prisma.$queryRawUnsafe<PredationRow[]>(
      `SELECT date AS date, COUNT(*) AS count
       FROM GamePredationEvent
       WHERE date >= ?
       GROUP BY date`,
      lookbackIso,
    );
  } catch (err) {
    // GamePredationEvent may be missing on legacy tenants — skip the game source
    // gracefully but warn with context so ops can tell "no events" from "no table".
    console.warn(`[alerts:PREDATOR_SPIKE] GamePredationEvent query failed — skipping game source`, {
      err: err instanceof Error ? err.message : String(err),
    });
    gameRows = [];
  }

  // Aggregate per-day predator-loss observations (sheep/livestock).
  const obsRows = await prisma.$queryRawUnsafe<PredationRow[]>(
    `SELECT substr(observedAt, 1, 10) AS date, COUNT(*) AS count
     FROM Observation
     WHERE type = 'predation_loss'
       AND substr(observedAt, 1, 10) >= ?
     GROUP BY substr(observedAt, 1, 10)`,
    lookbackIso,
  );

  // Union: sum counts per date.
  const perDay = new Map<string, number>();
  for (const r of [...gameRows, ...obsRows]) {
    const n = Number(r.count ?? 0);
    perDay.set(r.date, (perDay.get(r.date) ?? 0) + n);
  }

  const todayCount = perDay.get(todayIso) ?? 0;
  if (todayCount < MIN_TODAY_COUNT) return [];

  // Baseline excludes today.
  const baseline: number[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    baseline.push(perDay.get(toIsoDate(d)) ?? 0);
  }
  const mu = mean(baseline);
  const sigma = stdDev(baseline, mu);
  const threshold = mu + SIGMA_MULTIPLIER * sigma;
  if (todayCount <= threshold) return [];

  return [
    {
      type: PREDATOR_SPIKE_TYPE,
      category: "predator",
      severity: "red",
      dedupKey: `PREDATOR_SPIKE:farm:${todayIso}`,
      collapseKey: null,
      payload: {
        todayCount,
        baselineMean: Math.round(mu * 100) / 100,
        baselineStdDev: Math.round(sigma * 100) / 100,
        threshold: Math.round(threshold * 100) / 100,
        lookbackDays: 7,
      },
      message: `${todayCount} predator losses today — ${SIGMA_MULTIPLIER}σ above 7-day baseline (μ=${mu.toFixed(1)})`,
      href: `/admin/observations?type=predation_loss`,
      expiresAt: defaultExpiry(),
    },
  ];
}
