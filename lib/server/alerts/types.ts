// lib/server/alerts/types.ts — Phase J alert engine shared types
//
// A single "candidate" alert flows through the pipeline:
//
//   generator (evaluate) → persistNotifications (dedup/merge) → dispatch (push/email)
//
// Generators are pure(-ish) — they read from Prisma + settings and return
// AlertCandidate[]. The candidate model is independent of Prisma's Notification
// row so we can dedup/merge across candidates before a single DB write.
//
// Categories are intentionally stable strings (not enums) because they are
// user-visible strings in AlertPreference and cannot be renumbered casually.

import type { PrismaClient } from "@prisma/client";
import type { FarmSettings } from "@prisma/client";

export type AlertCategory =
  | "reproduction"
  | "performance"
  | "veld"
  | "finance"
  | "compliance"
  | "weather"
  | "predator";

export type AlertSeverity = "red" | "amber";

export interface AlertCandidate {
  /** Stable uppercase type, e.g. "LAMBING_DUE_7D" or "TAX_DEADLINE_IT3". */
  type: string;
  category: AlertCategory;
  severity: AlertSeverity;
  /** Idempotent per-period key: `${type}:${scopeId}:${isoPeriod}`. */
  dedupKey: string;
  /** Grouping unit — campId, speciesId, tenantId. null when alert is singleton. */
  collapseKey: string | null;
  /** Arbitrary JSON payload persisted into Notification.payload. */
  payload: Record<string, unknown>;
  /** Pre-rendered human message. */
  message: string;
  /** Deep-link href (relative, farm-scoped). */
  href: string;
  expiresAt: Date;
}

/**
 * Shape every alert generator must expose. Each module under lib/server/alerts
 * exports `evaluate(prisma, settings, slug)` returning AlertCandidate[].
 */
export type AlertGenerator = (
  prisma: PrismaClient,
  settings: FarmSettings,
  farmSlug: string,
) => Promise<AlertCandidate[]>;

/** Collapse thresholds per research brief §B. Default is 1 (no collapse). */
export const COLLAPSE_THRESHOLD: Record<string, number> = {
  NO_WEIGHING_90D: 3,
  COVER_READING_STALE_21D: 3,
  LAMBING_DUE_7D: 5,
  PREDATOR_SPIKE: 1,
};

export function getCollapseThreshold(type: string): number {
  return COLLAPSE_THRESHOLD[type] ?? 1;
}
