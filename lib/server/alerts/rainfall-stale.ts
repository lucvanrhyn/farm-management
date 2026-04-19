// lib/server/alerts/rainfall-stale.ts — RAINFALL_NOT_LOGGED.
//
// Research brief §D row 5: fire when `max(RainfallRecord.date) < now -
// FarmSettings.campGrazingWarningDays` (reuses the existing setting rather
// than introducing a new threshold).

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, diffDays, toIsoDate, toIsoWeek } from "./helpers";

export async function evaluate(
  prisma: PrismaClient,
  settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  const latest = await prisma.rainfallRecord.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });

  const threshold = settings.campGrazingWarningDays ?? 7;
  const now = new Date();

  if (!latest) {
    return [
      {
        type: "RAINFALL_NOT_LOGGED",
        category: "weather",
        severity: "amber",
        dedupKey: `RAINFALL_NOT_LOGGED:farm:${toIsoWeek(now)}`,
        collapseKey: null,
        payload: { daysSince: null, thresholdDays: threshold },
        message: "No rainfall readings on record — start logging to track drought risk",
        href: `/admin/settings/rainfall`,
        expiresAt: defaultExpiry(now),
      },
    ];
  }

  const lastDate = new Date(latest.date);
  if (Number.isNaN(lastDate.getTime())) return [];
  const daysSince = diffDays(now, lastDate);
  if (daysSince < threshold) return [];

  return [
    {
      type: "RAINFALL_NOT_LOGGED",
      category: "weather",
      severity: "amber",
      dedupKey: `RAINFALL_NOT_LOGGED:farm:${toIsoDate(now)}`,
      collapseKey: null,
      payload: { daysSince, thresholdDays: threshold, lastDate: latest.date },
      message: `Rainfall not logged for ${daysSince} days (threshold ${threshold}d)`,
      href: `/admin/settings/rainfall`,
      expiresAt: defaultExpiry(now),
    },
  ];
}
