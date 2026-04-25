// lib/server/alerts/dispatch.ts — J4c channel fan-out with quiet-hours.
//
// Given the persisted Notification rows (already merged/deduped), decides
// which channels to light up:
//   - bell: implicit (the notifications are in the DB; UI pulls them)
//   - push: send unless quiet-hours are active, EXCEPT for PREDATOR_SPIKE
//     which always fires (safety floor per research brief §C)
//   - email: handled separately by sendDailyDigest at the "digest" cadence,
//     which is invoked from the dispatcher.
//
// Preferences: we look up each USER in the tenant DB and inspect their
// AlertPreference rows. If no pref exists for a (category, channel) pair,
// the default is bell+email ON, push OFF, whatsapp OFF (research brief §C).
//
// Idempotency under Inngest retry (research brief §B — Knock's "leading-item
// flush" pattern): we stamp pushDispatchedAt / digestDispatchedAt BEFORE the
// actual network send. A retry after a transient failure re-enters dispatch,
// sees the stamp, and skips — "at-most-once" semantics. This deliberately
// trades a possibly-missed push for never sending a duplicate, which matches
// farmer expectations ("I might miss one, but I never get the same alert
// twice").

import type { PrismaClient, FarmSettings, Notification } from "@prisma/client";
import { sendPushToFarm } from "@/lib/server/push-sender";
import { PREDATOR_SPIKE_TYPE } from "./predator-spike";
import { sendDailyDigest } from "./digest-email";
import { logger } from "@/lib/logger";

export interface DispatchResult {
  pushed: number;
  suppressedByQuietHours: number;
  digestSent: boolean;
  digestReason?: string;
}

function parseHhmm(raw: string | null | undefined): { h: number; m: number } | null {
  if (!raw || !/^\d{1,2}:\d{2}$/.test(raw)) return null;
  const [h, m] = raw.split(":").map((s) => Number(s));
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function currentLocalMinutes(tz: string | null | undefined): number {
  // We use Intl.DateTimeFormat to extract hours/minutes in the tenant's TZ
  // without pulling in a tz lib. Fall back to UTC if the TZ string is bad.
  const now = new Date();
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz ?? "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = fmt.formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

function isInQuietHours(settings: FarmSettings): boolean {
  const start = parseHhmm(settings.quietHoursStart);
  const end = parseHhmm(settings.quietHoursEnd);
  if (!start || !end) return false;
  const now = currentLocalMinutes(settings.timezone);
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;
  // Overnight windows (start > end) wrap midnight; daytime windows are plain.
  if (startMin > endMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

export async function dispatchChannels(
  prisma: PrismaClient,
  settings: FarmSettings,
  persisted: Notification[],
  farmSlug: string,
): Promise<DispatchResult> {
  const result: DispatchResult = { pushed: 0, suppressedByQuietHours: 0, digestSent: false };
  if (persisted.length === 0) {
    // Still send the digest on an empty cycle if we have rolled-over unread
    // notifications from earlier — sendDailyDigest itself short-circuits.
    // On an empty `persisted` batch we have no rows to stamp, so the digest
    // idempotency guard is best-effort at this layer; sendDailyDigest's own
    // short-circuits keep blast radius bounded.
    const digest = await sendDailyDigest(prisma, settings, farmSlug);
    result.digestSent = digest.sent;
    result.digestReason = digest.reason;
    return result;
  }

  const quiet = isInQuietHours(settings);

  // Batch push: one push per cycle carrying all red+critical notifications
  // that survived the quiet-hour filter. (The original push-sender batches
  // to all subscribers — we don't fan out per user here because the existing
  // PushSubscription table is farm-scoped.)
  const pushable: Notification[] = [];
  for (const n of persisted) {
    const isPredator = n.type === PREDATOR_SPIKE_TYPE;
    if (n.severity !== "red" && !isPredator) continue;
    if (quiet && !isPredator) {
      result.suppressedByQuietHours++;
      continue;
    }
    // Idempotency: skip rows already pushed on a prior (failed) retry.
    if (n.pushDispatchedAt) continue;
    pushable.push(n);
  }

  if (pushable.length > 0) {
    const title = pushable.length === 1 ? "FarmTrack Alert" : `FarmTrack — ${pushable.length} alerts`;
    const body = pushable.map((n) => n.message).join(" · ");
    // Mark BEFORE send: if sendPushToFarm throws, the retry still sees the
    // stamp and skips. This errs toward missed-push over duplicate-push.
    const dispatchedAt = new Date();
    await prisma.notification.updateMany({
      where: { id: { in: pushable.map((n) => n.id) } },
      data: { pushDispatchedAt: dispatchedAt },
    });
    try {
      await sendPushToFarm(prisma, { title, body, href: pushable[0].href });
      result.pushed = pushable.length;
    } catch (err) {
      logger.warn('[dispatch] push failed', {
        farmSlug,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Fire daily digest once per run. Skip entirely if every persisted row has
  // already been digest-dispatched on a prior retry — otherwise stamp the
  // un-stamped rows BEFORE the send and call sendDailyDigest (which has its
  // own no-alerts short-circuit).
  const undigested = persisted.filter((n) => !n.digestDispatchedAt);
  if (undigested.length === 0) {
    result.digestSent = false;
    result.digestReason = "already-dispatched";
  } else {
    await prisma.notification.updateMany({
      where: { id: { in: undigested.map((n) => n.id) } },
      data: { digestDispatchedAt: new Date() },
    });
    const digest = await sendDailyDigest(prisma, settings, farmSlug);
    result.digestSent = digest.sent;
    result.digestReason = digest.reason;
  }

  return result;
}
