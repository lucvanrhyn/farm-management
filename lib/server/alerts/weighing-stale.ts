// lib/server/alerts/weighing-stale.ts — NO_WEIGHING_90D.
//
// Research brief §D row 7: animals with no "weighing" observation in > 90
// days. Collapse by camp when a camp contributes ≥ 3 candidates.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, diffDays, toIsoWeek } from "./helpers";

const STALE_DAYS = 90;

interface AnimalRow {
  id: string;
  animalId: string;
  currentCamp: string;
}

interface WeighRow {
  animalId: string;
  observedAt: Date;
}

export async function evaluate(
  prisma: PrismaClient,
  _settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  const animals = (await prisma.animal.findMany({
    where: { status: "Active" },
    select: { id: true, animalId: true, currentCamp: true },
  })) as AnimalRow[];
  if (animals.length === 0) return [];

  const animalIds = animals.map((a) => a.id);
  const rows = (await prisma.observation.findMany({
    where: { animalId: { in: animalIds }, type: "weighing" },
    select: { animalId: true, observedAt: true },
    orderBy: { observedAt: "desc" },
  })) as WeighRow[];

  const latestByAnimal = new Map<string, Date>();
  for (const r of rows) {
    if (!r.animalId) continue;
    if (!latestByAnimal.has(r.animalId)) latestByAnimal.set(r.animalId, r.observedAt);
  }

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);
  const candidates: AlertCandidate[] = [];

  for (const a of animals) {
    const last = latestByAnimal.get(a.id);
    const daysSince = last ? diffDays(now, last) : null;
    if (daysSince !== null && daysSince < STALE_DAYS) continue;

    candidates.push({
      type: "NO_WEIGHING_90D",
      category: "performance",
      severity: "amber",
      dedupKey: `NO_WEIGHING_90D:${a.id}:${week}`,
      collapseKey: a.currentCamp || "tenant",
      payload: {
        animalId: a.animalId,
        animalInternalId: a.id,
        campId: a.currentCamp,
        daysSince,
      },
      message:
        daysSince === null
          ? `${a.animalId} has no weighing on record`
          : `${a.animalId} not weighed in ${daysSince} days`,
      href: `/admin/animals?focus=${encodeURIComponent(a.animalId)}`,
      expiresAt,
    });
  }

  return candidates;
}
