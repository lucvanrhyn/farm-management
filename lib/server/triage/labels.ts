/**
 * lib/server/triage/labels.ts — UI-facing labels + groupings for Triage.
 *
 * The detection/ranking layer (reasons.ts, project.ts) is headless: it knows a
 * reason's severity and weight but not how to *show* it. This module is the
 * single source of truth for the human strings the Triage UI renders — badge
 * labels, filter-option labels, and the snapshot-vs-history category split that
 * drives the "unlock more" strip.
 *
 * It is a NEW file (not bolted onto a heavily-mocked module) so component tests
 * can import it freely without disturbing existing vi.mock factories.
 *
 * Grounding rule (mirrors narrate.ts): labels are keyed by ReasonId, so the UI
 * can never display a reason that isn't registered.
 */

import { REASON_IDS, type ReasonId } from "./reasons";

/**
 * Snapshot reasons are computable from the Animal row on day-1 import — they
 * are ALWAYS available. History reasons need accumulated observation history
 * (weighings, dosings, treatments) to fire, so they read as greyed "unlock
 * more" categories until the farm has logged enough data.
 */
export const SNAPSHOT_REASON_IDS = [
  "no-camp",
  "missing-id",
  "missing-dob",
  "age-for-category",
  "no-weight-on-record",
] as const satisfies readonly ReasonId[];

export const HISTORY_REASON_IDS = [
  "poor-doer",
  "dosing-overdue",
  "in-withdrawal",
] as const satisfies readonly ReasonId[];

export type ReasonCategory = "snapshot" | "history";

/** Short Title-Case badge/filter label per reason. */
const REASON_LABELS: Record<ReasonId, string> = {
  "no-camp": "No camp",
  "missing-id": "Missing ID",
  "missing-dob": "Missing DOB",
  "age-for-category": "Age mismatch",
  "no-weight-on-record": "No weighing",
  "poor-doer": "Poor doer",
  "dosing-overdue": "Dosing overdue",
  "in-withdrawal": "In withdrawal",
};

/**
 * One-line explainer for the "unlock more" strip — what logging unlocks each
 * history category. Snapshot reasons are omitted (they're always live).
 */
const UNLOCK_HINTS: Record<(typeof HISTORY_REASON_IDS)[number], string> = {
  "poor-doer": "Log weighings to surface cattle that are falling behind.",
  "dosing-overdue": "Log dosings to surface sheep that are due again.",
  "in-withdrawal": "Log treatments to flag animals inside a withdrawal window.",
};

/** Human Title-Case label for a reason id. */
export function reasonLabel(id: ReasonId): string {
  return REASON_LABELS[id] ?? id;
}

/** Whether a reason is a snapshot (always-on) or history (unlockable) reason. */
export function reasonCategory(id: ReasonId): ReasonCategory {
  return (SNAPSHOT_REASON_IDS as readonly ReasonId[]).includes(id)
    ? "snapshot"
    : "history";
}

/** Explainer string for a history reason's unlock-more chip. */
export function unlockHint(id: (typeof HISTORY_REASON_IDS)[number]): string {
  return UNLOCK_HINTS[id];
}

/** Every reason id in stable registry order (re-exported for UI iteration). */
export const ALL_REASON_IDS: readonly ReasonId[] = REASON_IDS;
