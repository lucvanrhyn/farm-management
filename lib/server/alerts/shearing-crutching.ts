// lib/server/alerts/shearing-crutching.ts — SHEARING_DUE / CRUTCHING_DUE.
//
// Research brief §D row 3: ewes with last "shearing" observation > 8 months
// old are SHEARING_DUE (Dohne/MLA standard: 8-9 months between shears).
// CRUTCHING_DUE fires 30 days before expected lambing (reuses the same
// mating→gestation calc as lambing-due.ts, but triggers earlier).
//
// Both collapse by flock (tenantId) if ≥5 candidates.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { addDays, defaultExpiry, diffDays, toIsoWeek } from "./helpers";

const SHEAR_INTERVAL_DAYS = 240; // ~8 months
const CRUTCH_PRELAMBING_DAYS = 30;
const LAMBING_GESTATION_DAYS = 147;

interface ObservationRow {
  type: string;
  animalId: string | null;
  observedAt: Date;
}

export async function evaluate(
  prisma: PrismaClient,
  _settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  const ewes = await prisma.animal.findMany({
    where: { species: "sheep", status: "Active", sex: "Female" },
    select: { id: true, animalId: true },
  });
  if (ewes.length === 0) return [];

  const eweIds = ewes.map((e) => e.id);

  const obs = (await prisma.observation.findMany({
    where: {
      animalId: { in: eweIds },
      type: { in: ["shearing", "insemination", "joining", "heat_detection"] },
    },
    select: { type: true, animalId: true, observedAt: true },
    orderBy: { observedAt: "desc" },
  })) as ObservationRow[];

  const lastShearByAnimal = new Map<string, Date>();
  const lastMatingByAnimal = new Map<string, Date>();

  for (const o of obs) {
    if (!o.animalId) continue;
    if (o.type === "shearing") {
      if (!lastShearByAnimal.has(o.animalId)) lastShearByAnimal.set(o.animalId, o.observedAt);
    } else {
      if (!lastMatingByAnimal.has(o.animalId)) lastMatingByAnimal.set(o.animalId, o.observedAt);
    }
  }

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);

  const candidates: AlertCandidate[] = [];

  for (const ewe of ewes) {
    const lastShear = lastShearByAnimal.get(ewe.id);
    const daysSinceShear = lastShear ? diffDays(now, lastShear) : null;
    if (daysSinceShear === null || daysSinceShear >= SHEAR_INTERVAL_DAYS) {
      candidates.push({
        type: "SHEARING_DUE",
        category: "performance",
        severity: "amber",
        dedupKey: `SHEARING_DUE:${ewe.id}:${week}`,
        collapseKey: "tenant",
        payload: {
          animalId: ewe.animalId,
          animalInternalId: ewe.id,
          daysSinceShear,
        },
        message:
          daysSinceShear === null
            ? `${ewe.animalId} has no shearing on record`
            : `${ewe.animalId} last shorn ${daysSinceShear} days ago`,
        href: `/admin/animals?focus=${encodeURIComponent(ewe.animalId)}`,
        expiresAt,
      });
    }

    const lastMating = lastMatingByAnimal.get(ewe.id);
    if (lastMating) {
      const predictedLambing = addDays(lastMating, LAMBING_GESTATION_DAYS);
      const crutchWindowStart = addDays(predictedLambing, -CRUTCH_PRELAMBING_DAYS);
      if (now >= crutchWindowStart && now <= predictedLambing) {
        const daysToLambing = diffDays(predictedLambing, now);
        candidates.push({
          type: "CRUTCHING_DUE",
          category: "performance",
          severity: "amber",
          dedupKey: `CRUTCHING_DUE:${ewe.id}:${week}`,
          collapseKey: "tenant",
          payload: {
            animalId: ewe.animalId,
            animalInternalId: ewe.id,
            daysToLambing,
          },
          message: `${ewe.animalId} crutching due (${daysToLambing} day${daysToLambing === 1 ? "" : "s"} pre-lambing)`,
          href: `/admin/animals?focus=${encodeURIComponent(ewe.animalId)}`,
          expiresAt,
        });
      }
    }
  }

  return candidates;
}
