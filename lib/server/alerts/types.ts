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

/**
 * Proactive Nudges v1 (#nudges) — a one-tap recommended action that rides
 * alongside an alert. Targets + prefill are ALWAYS resolved deterministically
 * from the alert-engine payload (never the LLM): `attachActions`
 * (lib/server/nudges/action-map.ts) maps a candidate's `type` to one of a
 * fixed table of actions and pulls the target ids out of `payload`.
 *
 * Kept in alerts/types.ts (rather than a nudges module) so AlertCandidate can
 * carry it without a cross-package import cycle. The action is persisted INSIDE
 * Notification.payload (no DB column) — `attachActions` merges it into payload
 * before persistNotifications writes, and dedup's merge/collapse preserve it.
 */
export interface RecommendedAction {
  /** Task type the action seeds, e.g. "weighing", "camp_move". */
  taskType: string;
  /** The thing the action operates on — at most one id is set. */
  target: { campId?: string; animalId?: string; waterPointId?: string };
  /** Form prefill values, resolved from the engine payload. */
  prefill: Record<string, unknown>;
  /** Human button label, e.g. "Weigh COW-12". */
  label: string;
  /**
   * Set when the action exists but the farm's tier doesn't unlock it (IT3 on
   * a non-advanced farm). The feed/UI render it as an upgrade prompt rather
   * than a one-tap action; `accept` navigation is suppressed.
   */
  upgradeGated?: boolean;
}

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
  /**
   * Proactive Nudges v1 — optional one-tap action enrichment. Populated by
   * `attachActions` for the candidate types in the action-map; absent for
   * info-only signals. Also mirrored into `payload.action` (so it survives the
   * Notification.payload round-trip); this typed field is the in-pipeline copy.
   */
  action?: RecommendedAction;
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

/**
 * Collapse thresholds per research brief §B.
 *
 * The default is 1, which COLLAPSES EAGERLY: `collapseCandidates` folds any
 * group where `group.length < threshold` is false, and `N < 1` is always false,
 * so a default-1 type collapses even a single candidate into the generic
 * "N … (grouped)" aggregate. That is the intended behaviour for info-only
 * tenant-collapsed signals (the aggregate IS the message), but it is WRONG for
 * Proactive Nudges v1 action-bearing types: their entire value is one targeted
 * one-tap action PER camp/mob/water-point/animal, and collapse keeps only the
 * first member's action (dedup.ts) while discarding the rest. So every
 * action-bearing type that uses `collapseKey: "tenant"` is registered here with
 * a real noise threshold (>1) — below it, each candidate passes through with its
 * own action intact; at/above it, folding into one aggregate is deliberate noise
 * control and a representative action survives.
 */
export const COLLAPSE_THRESHOLD: Record<string, number> = {
  NO_WEIGHING_90D: 3,
  COVER_READING_STALE_21D: 3,
  LAMBING_DUE_7D: 5,
  PREDATOR_SPIKE: 1,
  // Proactive Nudges v1 — per-entity action-bearing, tenant-collapsed. Keep
  // single/low-count nudges individually targeted (see block comment above).
  // SHEARING_DUE/CRUTCHING_DUE: 5 matches shearing-crutching.ts ("collapse by
  // flock if ≥5"). The per-infrastructure types (camp / mob / water point) are
  // few per farm, so a 3-item noise floor keeps each targeted until it's noise.
  SHEARING_DUE: 5,
  CRUTCHING_DUE: 5,
  WATER_SERVICE_OVERDUE_30D: 3,
  NEEDS_INSPECTION_DUE: 3,
  ROTATION_MOVE_DUE: 3,
};

export function getCollapseThreshold(type: string): number {
  return COLLAPSE_THRESHOLD[type] ?? 1;
}
