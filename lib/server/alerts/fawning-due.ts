// lib/server/alerts/fawning-due.ts — FAWNING_DUE per-game-species.
//
// Research brief §D row 2 (MOAT — no competitor fires this): one alert per
// GAME species whose current GameCensusEvent → recruitmentRate × population
// implies fawning season is active in the next 14 days, based on
// lib/species/gestation.ts gestation days.
//
// We don't track per-animal matings for game — use the species-level signal:
// last GameCensusEvent date + gestation offset into the future, firing when
// predicted fawning window opens.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { addDays, defaultExpiry, diffDays, toIsoWeek } from "./helpers";
import {
  GESTATION_TABLE,
  type GestationBreed,
  type GestationEntry,
} from "@/lib/species/gestation";
import { logger } from "@/lib/logger";

const FAWNING_WINDOW_DAYS = 14;

interface GameSpeciesRow {
  id: string;
  commonName: string;
  lastCensusDate: string | null;
  gestationDays: number | null;
}

function normaliseBreed(commonName: string): GestationBreed | null {
  const slug = commonName.toLowerCase().replace(/[^a-z]/g, "");
  // Map common names to GestationBreed identifiers. Anything not in the table
  // returns null → skipped (no silent wrong-species alerts).
  const direct: Record<string, GestationBreed> = {
    kudu: "kudu",
    greaterkudu: "kudu",
    impala: "impala",
    wildebeest: "wildebeest",
    bluewildebeest: "wildebeest",
    eland: "eland",
    gemsbok: "gemsbok",
    oryx: "gemsbok",
    warthog: "warthog",
    blesbuck: "blesbuck",
    blesbok: "blesbuck",
    springbok: "springbok",
    springbuck: "springbok",
  };
  const breed = direct[slug];
  return breed && GESTATION_TABLE[breed] ? breed : null;
}

export async function evaluate(
  prisma: PrismaClient,
  _settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  // GameSpecies table is present on Game-enabled tenants only — fall back to
  // [] gracefully if the model doesn't exist in the compiled client, though
  // with schema owned by Team SCHEMA this should always be present.
  let species: GameSpeciesRow[];
  try {
    species = await prisma.gameSpecies.findMany({
      select: { id: true, commonName: true, lastCensusDate: true, gestationDays: true },
    });
  } catch (err) {
    logger.warn('[alerts:FAWNING_DUE] GameSpecies query failed — skipping tenant', {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  if (species.length === 0) return [];

  const now = new Date();
  const windowEnd = addDays(now, FAWNING_WINDOW_DAYS);
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);

  const candidates: AlertCandidate[] = [];

  for (const sp of species) {
    if (!sp.lastCensusDate) continue;
    const censusDate = new Date(sp.lastCensusDate);
    if (Number.isNaN(censusDate.getTime())) continue;

    // Prefer explicit gestationDays on GameSpecies; otherwise look up from table.
    let days = sp.gestationDays ?? null;
    let entry: GestationEntry | null = null;
    if (days == null) {
      const breed = normaliseBreed(sp.commonName);
      if (!breed) continue;
      entry = GESTATION_TABLE[breed];
      days = entry.days;
    }

    const predictedFawning = addDays(censusDate, days);
    // Fire when predicted fawning window opens — between today and +14d.
    if (predictedFawning < now || predictedFawning > windowEnd) continue;

    const daysToFawning = diffDays(predictedFawning, now);
    const label = entry?.label ?? sp.commonName;
    candidates.push({
      type: "FAWNING_DUE",
      category: "reproduction",
      severity: "amber",
      dedupKey: `FAWNING_DUE:${sp.id}:${week}`,
      collapseKey: sp.id,
      payload: {
        speciesId: sp.id,
        speciesName: sp.commonName,
        gestationDays: days,
        daysToFawning,
        predictedDate: predictedFawning.toISOString(),
      },
      message: `${label} fawning window opening in ${daysToFawning} day${daysToFawning === 1 ? "" : "s"}`,
      href: `/admin/game/species/${sp.id}`,
      expiresAt,
    });
  }

  return candidates;
}
