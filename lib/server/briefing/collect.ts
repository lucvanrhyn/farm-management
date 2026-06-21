/**
 * lib/server/briefing/collect.ts — Weekly Farm Briefing v1 source-fetch shell.
 *
 * The I/O seam that reads every briefing source for a tenant over a 7-day
 * window and folds them into a deterministic BriefingPayload (payload.ts is the
 * pure transform; this is the impure fetch around it).
 *
 * GRACEFUL DEGRADATION is load-bearing: every source fetch is INDEPENDENTLY
 * fail-soft (`.catch(() => default)`), so a throw on one source contributes
 * nothing rather than taking the whole briefing down. The card and the email
 * therefore always render whatever the reachable sources produced.
 *
 * Species reads (Animal / Observation) go through scoped()/crossSpecies() per
 * the species-where door rule; the 7-day key-changes are farm-wide rollups, so
 * crossSpecies() is the correct door (mirrors getDeathsAndSales). Notification
 * / AlertPreference are NOT species models — raw prisma is allowed.
 */

import type { PrismaClient } from "@prisma/client";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { getTriage } from "@/lib/server/triage/get-triage";
import { getDoNextFeed, type DoNextItem } from "@/lib/server/nudges/feed";
import type { AttentionItem } from "@/lib/server/triage/types";
import { getDroughtPayload } from "@/lib/server/drought";
import { getFarmSummary as getVeldSummary } from "@/lib/server/veld-score";
import {
  buildBriefingPayload,
  type BriefingPayload,
  type BriefingNotification,
  type BriefingKeyChanges,
} from "./payload";

const WINDOW_DAYS = 7;
/** Cap on notification rows pulled into the briefing window. */
const NOTIFICATION_TAKE = 200;
/** Cap on observation rows pulled per key-change query. */
const OBSERVATION_TAKE = 100_000;
/** Cap on sold-animal rows pulled for the attrition count. */
const SOLD_ANIMAL_TAKE = 10_000;

/** Cattle reproduction observation types counted as "repro events". */
const REPRO_EVENT_TYPES = ["calving", "insemination", "pregnancy_scan"] as const;

export interface CollectOptions {
  now: Date;
  /** Whose nudges feed to read (recipient for email, current user in-app). */
  userEmail: string;
  farmName: string;
  /**
   * Already-loaded sources from the caller (the dashboard card path). When a
   * field is provided, the briefing REUSES it instead of recomputing — the
   * dashboard already ran getTriage (mode-scoped teaser) + getDoNextFeed on the
   * same render, so re-fetching them here would run the hot authenticated page's
   * heaviest reads twice (F1). Omitted (email path) → both fetched farm-wide.
   */
  prefetched?: {
    attentionItems?: AttentionItem[];
    doNext?: DoNextItem[];
  };
}

export interface CollectResult {
  payload: BriefingPayload;
}

function windowStart(now: Date): Date {
  return new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** Default thresholds (same defaults the dashboard teaser uses). */
async function resolveThresholds(prisma: PrismaClient) {
  const settings = await prisma.farmSettings
    .findFirst({
      select: {
        adgPoorDoerThreshold: true,
        calvingAlertDays: true,
        daysOpenLimit: true,
        campGrazingWarningDays: true,
        alertThresholdHours: true,
        repeatedTreatmentCount: true,
        repeatedTreatmentWindowDays: true,
        latitude: true,
        longitude: true,
      },
    })
    .catch(() => null);
  return {
    thresholds: {
      adgPoorDoerThreshold: settings?.adgPoorDoerThreshold ?? 0.7,
      calvingAlertDays: settings?.calvingAlertDays ?? 14,
      daysOpenLimit: settings?.daysOpenLimit ?? 365,
      campGrazingWarningDays: settings?.campGrazingWarningDays ?? 7,
      staleCampInspectionHours: settings?.alertThresholdHours ?? 48,
      // Per-farm repeated-treatments config so the weekly briefing flags the
      // same animals as the triage + profitability pages (not the hardcoded default).
      repeatedTreatmentCount: settings?.repeatedTreatmentCount ?? 3,
      repeatedTreatmentWindowDays: settings?.repeatedTreatmentWindowDays ?? 90,
    },
    latitude: settings?.latitude ?? null,
    longitude: settings?.longitude ?? null,
  };
}

async function readRecentNotifications(
  prisma: PrismaClient,
  since: Date,
): Promise<BriefingNotification[]> {
  // Notification is NOT a species model — raw prisma is allowed. take + select
  // satisfy the findMany audits.
  const rows = await prisma.notification
    .findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: NOTIFICATION_TAKE,
      select: { id: true, type: true, severity: true, message: true, href: true, createdAt: true },
    })
    .catch(() => [] as BriefingNotification[]);
  return rows as BriefingNotification[];
}

async function readKeyChanges(
  prisma: PrismaClient,
  since: Date,
  latitude: number | null,
  longitude: number | null,
  now: Date,
): Promise<BriefingKeyChanges> {
  // Farm-wide 7-day rollup — same door/reason as getDeathsAndSales.
  const xs = crossSpecies(prisma, "analytics-rollup");

  const [weighings, reproEvents, deaths, sold, drought, veld] = await Promise.all([
    // weighings logged this week (count of weighing observations, farm-wide).
    xs.observation
      .findMany({
        where: { type: "weighing", observedAt: { gte: since } },
        select: { id: true },
        take: OBSERVATION_TAKE,
      })
      .then((r) => r.length)
      .catch(() => 0),
    // reproduction events this week (calving / insemination / scan).
    xs.observation
      .findMany({
        where: { type: { in: REPRO_EVENT_TYPES as unknown as string[] }, observedAt: { gte: since } },
        select: { id: true },
        take: OBSERVATION_TAKE,
      })
      .then((r) => r.length)
      .catch(() => 0),
    // deaths this week (getDeathsAndSales is monthly — this is the 7-day window).
    xs.observation
      .findMany({
        where: { type: "death", observedAt: { gte: since } },
        select: { id: true },
        take: OBSERVATION_TAKE,
      })
      .then((r) => r.length)
      .catch(() => 0),
    // sales this week — animals flipped to Sold. dateAdded is a STRING column
    // (free-format), so we read Sold animals and post-filter the 7-day window
    // in JS (mirrors getDeathsAndSales, which also can't range-query dateAdded).
    // audit-allow-deceased-flag: status:Sold is the literal status predicate; we want sold (not active) animals.
    xs.animal
      .findMany({
        where: { status: "Sold" },
        select: { dateAdded: true },
        take: SOLD_ANIMAL_TAKE,
      })
      .then((rows) =>
        rows.filter((a) => {
          if (!a.dateAdded) return false;
          const t = new Date(a.dateAdded).getTime();
          return !Number.isNaN(t) && t >= since.getTime();
        }).length,
      )
      .catch(() => 0),
    latitude != null && longitude != null
      ? getDroughtPayload(prisma, latitude, longitude).catch(() => null)
      : Promise.resolve(null),
    getVeldSummary(prisma, now).catch(() => null),
  ]);

  return {
    weightsLogged: weighings,
    reproEvents,
    deaths,
    sales: sold,
    veld: veld
      ? { criticalCamps: veld.critical.length, decliningCamps: veld.declining.length }
      : null,
    drought:
      drought && drought.current
        ? { spiSeverity: drought.current.severity, currentMonth: drought.current.month }
        : null,
  };
}

/**
 * Fetch all briefing sources for a tenant and assemble the deterministic
 * payload. Used by BOTH the weekly email send path and the in-app card shell
 * (getWeeklyBriefingForFarm).
 */
export async function collectBriefingSources(
  prisma: PrismaClient,
  farmSlug: string,
  opts: CollectOptions,
): Promise<CollectResult> {
  const since = windowStart(opts.now);
  const { thresholds, latitude, longitude } = await resolveThresholds(prisma);

  const pre = opts.prefetched;
  const [notifications, attentionItems, doNext, keyChanges] = await Promise.all([
    readRecentNotifications(prisma, since),
    // Reuse the dashboard's already-loaded triage when the caller passed it;
    // otherwise (email path) compute farm-wide. `!== undefined` so an empty
    // prefetched list is honoured as "nothing to watch", not a refetch trigger.
    pre?.attentionItems !== undefined
      ? Promise.resolve(pre.attentionItems)
      : getTriage(prisma, farmSlug, thresholds).catch(() => [] as AttentionItem[]),
    pre?.doNext !== undefined
      ? Promise.resolve(pre.doNext)
      : opts.userEmail
        ? getDoNextFeed(farmSlug, opts.userEmail, opts.now).catch(() => [] as DoNextItem[])
        : Promise.resolve([] as DoNextItem[]),
    readKeyChanges(prisma, since, latitude, longitude, opts.now),
  ]);

  const payload = buildBriefingPayload({
    farmName: opts.farmName,
    notifications,
    attentionItems,
    doNext,
    keyChanges,
    now: opts.now,
  });

  return { payload };
}
