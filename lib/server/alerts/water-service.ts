// lib/server/alerts/water-service.ts — WATER_SERVICE_OVERDUE_30D.
//
// Research brief §D row 9: GameWaterPoint.lastInspected < now - 30d. On
// tenants without a GameWaterPoint table, log once and return [].

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, diffDays, toIsoDate, toIsoWeek } from "./helpers";
import { logger } from "@/lib/logger";

const STALE_DAYS = 30;

interface WaterPointRow {
  id: string;
  name: string;
  lastInspected: string | null;
  status: string;
}

export async function evaluate(
  prisma: PrismaClient,
  _settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  let points: WaterPointRow[];
  try {
    points = await prisma.gameWaterPoint.findMany({
      select: { id: true, name: true, lastInspected: true, status: true },
    });
  } catch (err) {
    // GameWaterPoint may not exist on older tenants — skip gracefully per-tenant.
    // No module-level dedup: each tenant logs its own warning once per cron cycle,
    // which is the correct granularity (prior module-scoped flag suppressed
    // warnings for all subsequent tenants in the same Node process).
    logger.warn('[alerts:WATER_SERVICE_OVERDUE_30D] missing table on tenant — skipping', {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  if (points.length === 0) return [];

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);
  const candidates: AlertCandidate[] = [];

  for (const wp of points) {
    const last = wp.lastInspected ? new Date(wp.lastInspected) : null;
    const daysSince = last && !Number.isNaN(last.getTime()) ? diffDays(now, last) : null;
    if (daysSince !== null && daysSince < STALE_DAYS) continue;

    candidates.push({
      type: "WATER_SERVICE_OVERDUE_30D",
      category: "compliance",
      severity: "amber",
      dedupKey: `WATER_SERVICE_OVERDUE_30D:${wp.id}:${week}`,
      collapseKey: "tenant",
      payload: {
        waterPointId: wp.id,
        name: wp.name,
        daysSince,
        lastInspected: wp.lastInspected,
        status: wp.status,
      },
      message:
        daysSince === null
          ? `Water point "${wp.name}" has no service on record`
          : `Water point "${wp.name}" last serviced ${daysSince} days ago`,
      href: `/admin/game/infrastructure`,
      expiresAt,
    });
  }

  // Also surface explicitly-flagged non-operational points as a same-day alert.
  for (const wp of points) {
    if (wp.status === "operational") continue;
    candidates.push({
      type: "WATER_SERVICE_OVERDUE_30D",
      category: "compliance",
      severity: "red",
      dedupKey: `WATER_SERVICE_NON_OP:${wp.id}:${toIsoDate(now)}`,
      collapseKey: "tenant",
      payload: { waterPointId: wp.id, name: wp.name, status: wp.status },
      message: `Water point "${wp.name}" status: ${wp.status}`,
      href: `/admin/game/infrastructure`,
      expiresAt,
    });
  }

  return candidates;
}
