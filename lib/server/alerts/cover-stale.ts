// lib/server/alerts/cover-stale.ts — COVER_READING_STALE_21D (MOAT).
//
// Research brief §D row 6: for each camp, check latest CampCoverReading —
// fire when > 21 days old or missing entirely. Collapse by tenant when
// candidates ≥ 3 (COLLAPSE_THRESHOLD default).

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, diffDays, toIsoWeek } from "./helpers";

const STALE_DAYS = 21;

interface CampRow {
  id: string;
  campId: string;
  campName: string;
}

interface CoverRow {
  campId: string;
  recordedAt: string;
}

export async function evaluate(
  prisma: PrismaClient,
  _settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  const camps = (await prisma.camp.findMany({
    select: { id: true, campId: true, campName: true },
  })) as CampRow[];
  if (camps.length === 0) return [];

  const latestPerCamp = await prisma.$queryRawUnsafe<CoverRow[]>(
    `SELECT campId AS campId, MAX(recordedAt) AS recordedAt
     FROM CampCoverReading
     GROUP BY campId`,
  );
  const latestByCamp = new Map<string, string>();
  for (const r of latestPerCamp) latestByCamp.set(r.campId, r.recordedAt);

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);
  const candidates: AlertCandidate[] = [];

  for (const camp of camps) {
    const recordedAt = latestByCamp.get(camp.campId);
    if (!recordedAt) {
      candidates.push({
        type: "COVER_READING_STALE_21D",
        category: "veld",
        severity: "amber",
        dedupKey: `COVER_READING_STALE_21D:${camp.id}:${week}`,
        collapseKey: "tenant",
        payload: {
          campId: camp.campId,
          campName: camp.campName,
          campInternalId: camp.id,
          daysSince: null,
        },
        message: `${camp.campName}: no cover reading on record`,
        href: `/admin/camps/${camp.campId}`,
        expiresAt,
      });
      continue;
    }
    const lastDate = new Date(recordedAt);
    if (Number.isNaN(lastDate.getTime())) continue;
    const daysSince = diffDays(now, lastDate);
    if (daysSince < STALE_DAYS) continue;

    candidates.push({
      type: "COVER_READING_STALE_21D",
      category: "veld",
      severity: "amber",
      dedupKey: `COVER_READING_STALE_21D:${camp.id}:${week}`,
      collapseKey: "tenant",
      payload: {
        campId: camp.campId,
        campName: camp.campName,
        campInternalId: camp.id,
        daysSince,
      },
      message: `${camp.campName}: cover reading ${daysSince} days old (stale >21d)`,
      href: `/admin/camps/${camp.campId}`,
      expiresAt,
    });
  }

  return candidates;
}
