// lib/server/alerts/lambing-due.ts — LAMBING_DUE_7D generator.
//
// Research brief §D row 1: sheep with pregnancy scan "pregnant" whose
// last mating + 147d (Dohne Merino standard, MLA) lands in the next 7 days.
//
// Data model gotcha: reproduction state in FarmTrack lives in Observation
// rows, not on Animal directly. We pull the most recent heat/insemination
// obs per ewe and the most recent pregnancy_scan obs (which stores result
// in Observation.details JSON). A sheep is "pregnant" if her latest scan
// details parse to { result: "pregnant" } AND mating + 147d > today.
//
// Dedup: per-animal weekly, collapseKey = tenantId when candidate count ≥ 5.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { addDays, defaultExpiry, diffDays, toIsoWeek } from "./helpers";
import { logger } from "@/lib/logger";

const DEFAULT_GESTATION_DAYS = 147;
const LEAD_DAYS = 7;

interface ObservationRow {
  id: string;
  type: string;
  animalId: string | null;
  observedAt: Date;
  details: string;
}

function parsePregnant(details: string): boolean {
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    const result = typeof parsed.result === "string" ? parsed.result.toLowerCase() : "";
    return result === "pregnant";
  } catch (err) {
    // Malformed details JSON on a single pregnancy_scan row — treat as "not pregnant"
    // so the alert doesn't fire, and log so the data-quality issue is visible.
    logger.warn('[alerts:LAMBING_DUE_7D] malformed pregnancy_scan details — treating as not pregnant', {
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function evaluate(
  prisma: PrismaClient,
  _settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  const ewes = await prisma.animal.findMany({
    where: { species: "sheep", status: "Active", sex: "Female" },
    select: { id: true, animalId: true, breed: true },
  });
  if (ewes.length === 0) return [];

  const eweIds = ewes.map((e) => e.id);

  // Pull heat/insemination/joining/pregnancy_scan observations for these ewes
  // in one query, then reduce per-animal.
  const obs = (await prisma.observation.findMany({
    where: {
      animalId: { in: eweIds },
      type: { in: ["insemination", "heat_detection", "joining", "pregnancy_scan"] },
    },
    select: { id: true, type: true, animalId: true, observedAt: true, details: true },
    orderBy: { observedAt: "desc" },
  })) as ObservationRow[];

  const lastMatingByAnimal = new Map<string, Date>();
  const pregnantByAnimal = new Map<string, boolean>();

  for (const o of obs) {
    if (!o.animalId) continue;
    if (o.type === "pregnancy_scan") {
      // keep only the FIRST (most recent due to orderBy desc) scan per animal
      if (!pregnantByAnimal.has(o.animalId)) {
        pregnantByAnimal.set(o.animalId, parsePregnant(o.details));
      }
    } else {
      // heat/insemination/joining count as mating event
      const existing = lastMatingByAnimal.get(o.animalId);
      if (!existing || o.observedAt > existing) {
        lastMatingByAnimal.set(o.animalId, o.observedAt);
      }
    }
  }

  const now = new Date();
  const windowEnd = addDays(now, LEAD_DAYS);
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);

  const candidates: AlertCandidate[] = [];

  for (const ewe of ewes) {
    if (!pregnantByAnimal.get(ewe.id)) continue;
    const lastMating = lastMatingByAnimal.get(ewe.id);
    if (!lastMating) continue;
    const due = addDays(lastMating, DEFAULT_GESTATION_DAYS);
    if (due < now || due > windowEnd) continue;
    const daysToLambing = diffDays(due, now);
    candidates.push({
      type: "LAMBING_DUE_7D",
      category: "reproduction",
      severity: "amber",
      dedupKey: `LAMBING_DUE_7D:${ewe.id}:${week}`,
      collapseKey: "tenant",
      payload: {
        animalId: ewe.animalId,
        animalInternalId: ewe.id,
        daysToLambing,
        dueDate: due.toISOString(),
      },
      message: `${ewe.animalId} lambing due in ${daysToLambing} day${daysToLambing === 1 ? "" : "s"}`,
      href: `/admin/animals?focus=${encodeURIComponent(ewe.animalId)}`,
      expiresAt,
    });
  }

  return candidates;
}
