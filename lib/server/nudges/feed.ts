// lib/server/nudges/feed.ts — the "Do Next" nudge feed.
//
// Proactive Nudges v1 (#nudges) — the ranked list of one-tap actions the
// dashboard DoNextPanel renders. It reads the SAME persisted notifications the
// NotificationBell does (via getCachedNotifications) and keeps only the ones
// that carry a `payload.action` (the action-eligible nudges).
//
// Ranking (decision 6) — the "triage urgency family" applied to actions:
//   1. severity      — red before amber,
//   2. category weight — compliance > veld > performance > the rest,
//   3. due-date proximity — sooner first (ties keep stable input order).
// The weight constants are net-new and owned here.
//
// `rankDoNextFeed` is PURE (no I/O, caller passes `now`) so it's unit-testable
// for exact ordering; `getDoNextFeed` is the thin fetch shell over the cache.

import { getCachedNotifications, type CachedNotification } from "@/lib/server/cached";
import type { RecommendedAction } from "@/lib/server/alerts";

/** A ranked, action-carrying nudge ready for the DoNextPanel. */
export interface DoNextItem {
  id: string;
  type: string;
  severity: "red" | "amber";
  message: string;
  href: string;
  action: RecommendedAction;
  /** ISO due-date if the action carries one (e.g. tax deadline). */
  dueDate: string | null;
  createdAt: string;
}

/** Severity rank — lower sorts first. */
const SEVERITY_RANK: Record<string, number> = { red: 0, amber: 1 };

/**
 * Category weight — HIGHER weight surfaces first within a severity band. The
 * order encodes "deadlines/compliance you can't miss" > "veld/grazing" >
 * "performance husbandry" > everything else. Net-new constants for v1.
 */
const CATEGORY_WEIGHT: Record<string, number> = {
  compliance: 50,
  finance: 45,
  predator: 40,
  weather: 35,
  veld: 30,
  reproduction: 25,
  performance: 20,
};
const DEFAULT_CATEGORY_WEIGHT = 10;

interface ParsedNudgePayload {
  action?: RecommendedAction;
  category?: string;
  dueDate?: string;
  deadline?: string;
}

function parsePayload(raw: string | null | undefined): ParsedNudgePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ParsedNudgePayload) : null;
  } catch {
    return null;
  }
}

function isRecommendedAction(v: unknown): v is RecommendedAction {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as RecommendedAction).taskType === "string" &&
    typeof (v as RecommendedAction).label === "string"
  );
}

function dueTimestamp(item: DoNextItem): number {
  if (!item.dueDate) return Number.POSITIVE_INFINITY; // no due-date sorts last
  const t = new Date(item.dueDate).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Filter notifications down to action-carrying, unread nudges and rank them.
 * Pure + total — `now` is accepted for parity with the rest of the pipeline
 * (currently unused by the comparator, reserved for future recency tie-break).
 */
export function rankDoNextFeed(
  notifications: readonly CachedNotification[],
  now: Date = new Date(),
): DoNextItem[] {
  void now; // reserved for a future recency tie-break; kept for call-site parity
  const items: Array<DoNextItem & { _cat: string }> = [];

  for (const n of notifications) {
    if (n.isRead) continue; // read = actioned or dismissed
    const payload = parsePayload(n.payload);
    if (!payload || !isRecommendedAction(payload.action)) continue;

    const severity = n.severity === "red" ? "red" : "amber";
    items.push({
      id: n.id,
      type: n.type,
      severity,
      message: n.message,
      href: n.href,
      action: payload.action,
      dueDate: payload.dueDate ?? payload.deadline ?? null,
      createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
      _cat: payload.category ?? "",
    });
  }

  items.sort((a, b) => {
    const sev = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    if (sev !== 0) return sev;
    const cat =
      (CATEGORY_WEIGHT[b._cat] ?? DEFAULT_CATEGORY_WEIGHT) -
      (CATEGORY_WEIGHT[a._cat] ?? DEFAULT_CATEGORY_WEIGHT);
    if (cat !== 0) return cat;
    return dueTimestamp(a) - dueTimestamp(b);
  });

  return items.map(({ _cat, ...item }) => {
    void _cat;
    return item;
  });
}

/**
 * Fetch + rank the do-next feed for a farm/user. Thin shell over the shared
 * notification cache (same source as the NotificationBell), so a nudge appears
 * in both surfaces from one persisted row.
 */
export async function getDoNextFeed(
  farmSlug: string,
  userEmail: string,
  now: Date = new Date(),
): Promise<DoNextItem[]> {
  const { notifications } = await getCachedNotifications(farmSlug, userEmail);
  return rankDoNextFeed(notifications, now);
}
