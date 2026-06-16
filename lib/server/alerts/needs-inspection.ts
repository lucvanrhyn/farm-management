// lib/server/alerts/needs-inspection.ts — NEEDS_INSPECTION_DUE.
//
// Proactive Nudges v1 (#nudges) — the notification sibling of the
// "stale-inspections" dashboard alert. The dashboard alert reports an aggregate
// COUNT ("3 camps not inspected within 48h"); this generator emits one TARGETED
// candidate per stale camp so `attachActions` can hang a one-tap
// `camp_inspection` action (with the campId) off each.
//
// Detection is SHARED with the dashboard alert via `computeStaleCampIds`
// (lib/server/alerts/stale-inspection.ts) — same `staleCampInspectionHours`
// threshold, same uninspected+aged rule. There is no second threshold to drift.
//
// Mirrors water-service.ts for structure: per-tenant graceful skip on a missing
// table, FarmSettings-gated threshold, stable weekly dedupKey + 48h expiry.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, toIsoWeek } from "./helpers";
import { computeStaleCampIds } from "./stale-inspection";
import { getLatestCampConditions } from "@/lib/server/camp-status";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { logger } from "@/lib/logger";

const DEFAULT_STALE_HOURS = 48;

export async function evaluate(
  prisma: PrismaClient,
  settings: FarmSettings,
  farmSlug: string,
): Promise<AlertCandidate[]> {
  const staleHours = settings.alertThresholdHours ?? DEFAULT_STALE_HOURS;

  let camps: Array<{ campId: string; campName: string }>;
  let conditions: Awaited<ReturnType<typeof getLatestCampConditions>>;
  try {
    // Camp is a species model — read through the crossSpecies door (this is a
    // farm-wide inspection roll-up, every camp regardless of species).
    [camps, conditions] = await Promise.all([
      crossSpecies(prisma, "notification-cron").camp.findMany({
        select: { campId: true, campName: true },
      }),
      getLatestCampConditions(prisma),
    ]);
  } catch (err) {
    logger.warn("[alerts:NEEDS_INSPECTION_DUE] read failed on tenant — skipping", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  if (camps.length === 0) return [];

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);

  const campNameById = new Map(camps.map((c) => [c.campId, c.campName]));
  const staleIds = computeStaleCampIds(
    conditions,
    camps.map((c) => c.campId),
    staleHours,
    now,
  );

  return staleIds.map((campId) => {
    const campName = campNameById.get(campId) ?? campId;
    return {
      type: "NEEDS_INSPECTION_DUE",
      category: "performance",
      severity: "amber",
      dedupKey: `NEEDS_INSPECTION_DUE:${campId}:${week}`,
      collapseKey: "tenant",
      payload: { campId, campName, staleHours },
      message: `Camp "${campName}" not inspected within ${staleHours}h`,
      href: `/${farmSlug}/admin/observations`,
      expiresAt,
    };
  });
}
