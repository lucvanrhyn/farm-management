// lib/server/alerts/lsu-overstock.ts — LSU_OVERSTOCK (MOAT).
//
// Research brief §F: mixed-species LSU math. Uses getMergedLsuValues() from
// lib/species/registry and camp carrying capacity from VeldAssessment.haPerLsu
// snapshot (already denormalised on VeldAssessment rows).
//
// Fire when stocked LSU > capacity × 1.1 on any camp.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, toIsoWeek } from "./helpers";
import { getMergedLsuValues } from "@/lib/species/registry";

const OVERSTOCK_MULTIPLIER = 1.1;

interface CampRow {
  id: string;
  campId: string;
  campName: string;
  sizeHectares: number | null;
}

interface AnimalRow {
  category: string;
  currentCamp: string;
  status: string;
}

interface VeldRow {
  campId: string;
  haPerLsu: number | null;
}

export async function evaluate(
  prisma: PrismaClient,
  _settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  const [camps, animals, veldRows] = await Promise.all([
    prisma.camp.findMany({
      select: { id: true, campId: true, campName: true, sizeHectares: true },
    }) as Promise<CampRow[]>,
    // cross-species by design: LSU overstock uses merged LSU values across all
    // species (cattle + sheep + game) per the brief's mixed-species math.
    prisma.animal.findMany({
      where: { status: "Active" },
      select: { category: true, currentCamp: true, status: true },
    }) as Promise<AnimalRow[]>,
    prisma.$queryRawUnsafe<VeldRow[]>(
      `SELECT campId, haPerLsu FROM VeldAssessment
       WHERE id IN (
         SELECT id FROM VeldAssessment va2
         WHERE va2.campId = VeldAssessment.campId
         ORDER BY assessmentDate DESC LIMIT 1
       )`,
    ).catch((err) => {
      console.warn(`[alerts:LSU_OVERSTOCK] veld assessment query failed — falling back to defaults`, {
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
  ]);

  if (camps.length === 0 || animals.length === 0) return [];

  const lsuValues = getMergedLsuValues();
  const latestHaPerLsu = new Map<string, number>();
  for (const v of veldRows) {
    if (v.haPerLsu && v.haPerLsu > 0) latestHaPerLsu.set(v.campId, v.haPerLsu);
  }

  // Aggregate stocked LSU per camp.
  const stockedByCamp = new Map<string, number>();
  for (const a of animals) {
    const lsu = lsuValues[a.category] ?? 0;
    stockedByCamp.set(a.currentCamp, (stockedByCamp.get(a.currentCamp) ?? 0) + lsu);
  }

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);
  const candidates: AlertCandidate[] = [];

  for (const camp of camps) {
    const stocked = stockedByCamp.get(camp.campId) ?? 0;
    if (stocked === 0) continue;
    const haPerLsu = latestHaPerLsu.get(camp.campId);
    if (!haPerLsu || !camp.sizeHectares || camp.sizeHectares <= 0) continue;
    const capacity = camp.sizeHectares / haPerLsu;
    const threshold = capacity * OVERSTOCK_MULTIPLIER;
    if (stocked <= threshold) continue;

    candidates.push({
      type: "LSU_OVERSTOCK",
      category: "veld",
      severity: "red",
      dedupKey: `LSU_OVERSTOCK:${camp.id}:${week}`,
      collapseKey: "tenant",
      payload: {
        campId: camp.campId,
        campName: camp.campName,
        stockedLsu: Math.round(stocked * 100) / 100,
        capacityLsu: Math.round(capacity * 100) / 100,
        haPerLsu,
        sizeHectares: camp.sizeHectares,
      },
      message: `${camp.campName}: ${stocked.toFixed(1)} LSU stocked vs ${capacity.toFixed(1)} LSU capacity (>${Math.round((OVERSTOCK_MULTIPLIER - 1) * 100)}% over)`,
      href: `/admin/camps/${camp.campId}`,
      expiresAt,
    });
  }

  return candidates;
}
