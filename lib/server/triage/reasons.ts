/**
 * lib/server/triage/reasons.ts — the Triage REASON_REGISTRY.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Why weights are NET-NEW
 * ──────────────────────────────────────────────────────────────────────
 * `AlertThresholds` (lib/server/dashboard-alerts.ts) holds only DETECTION
 * cutoffs (e.g. `adgPoorDoerThreshold`, `daysOpenLimit`) — the knobs that
 * decide WHETHER a finding fires. It has no notion of RANKING. Triage needs
 * to order one animal ahead of another, so it owns its own weight table
 * here. This is the single source of truth for every reason's severity and
 * urgency weight.
 *
 * Weight scheme (intentionally simple + auditable for v1):
 *  - weights encode relative priority WITHIN a severity band (a withdrawal
 *    breach that could put residue in the food chain > a missing
 *    date-of-birth). Keeping reds numerically above ambers is a readability
 *    convention, NOT the cross-band ordering guarantee;
 *  - the "any red outranks all-amber" invariant is enforced STRUCTURALLY by
 *    project.ts, which sorts on severity TIER first and only then on summed
 *    urgency. (Summed amber urgency CAN exceed a lone red's weight once an
 *    animal stacks enough amber reasons, so the per-reason band alone is not
 *    sufficient — see project.ts.)
 *
 * `urgency = Σ reason.weight` and `item.severity = max reason severity` are
 * computed in `project.ts`; this file only declares the per-reason facts.
 */

import type { Reason, ReasonSeverity } from "./types";

export interface ReasonMeta {
  severity: ReasonSeverity;
  weight: number;
}

/**
 * Severity bands. Keeping reds and ambers in disjoint numeric ranges is the
 * structural guarantee behind the "any red outranks all-amber" rule — see
 * reasons.test.ts which asserts min(red weight) > max(amber weight).
 */
const RED_BASE = 100;
const AMBER_BASE = 10;

export const REASON_REGISTRY = {
  // ── Snapshot reasons (pure Animal-attribute detectors) ──────────────────
  // Data-quality gaps surfaced on day-1 import. Amber: they don't endanger
  // the animal, but they block every downstream feature (repro, tax, EID).
  "no-camp": { severity: "amber", weight: AMBER_BASE + 5 },
  "missing-id": { severity: "amber", weight: AMBER_BASE + 4 },
  "missing-dob": { severity: "amber", weight: AMBER_BASE + 2 },
  "age-for-category": { severity: "amber", weight: AMBER_BASE + 3 },
  "no-weight-on-record": { severity: "amber", weight: AMBER_BASE + 1 },

  // ── History reasons (reuse of existing per-animal detectors) ────────────
  // poor-doer: cattle ADG below threshold — a welfare/management signal.
  "poor-doer": { severity: "amber", weight: AMBER_BASE + 6 },
  // dosing-overdue: sheep past the dosing cutoff — parasite-load risk.
  "dosing-overdue": { severity: "amber", weight: AMBER_BASE + 7 },
  // in-withdrawal: drug residue window still open. RED — selling or
  // slaughtering this animal is a food-safety / regulatory breach.
  "in-withdrawal": { severity: "red", weight: RED_BASE + 1 },

  // ── Underperformer reasons (repro / margin / treatment-cost) ────────────
  // All AMBER management signals (red stays reserved for in-withdrawal food
  // safety). Their SUMMED urgency on one animal can exceed a lone red's weight;
  // project.ts tiers by severity first so a red still outranks them regardless.
  // open-cow: cow open beyond the days-open limit — a breeding-failure signal.
  "open-cow": { severity: "amber", weight: AMBER_BASE + 8 },
  // unprofitable: realised per-animal margin negative or bottom-quartile of
  // its own category. Computed on the unsold active roster, so always advisory.
  "unprofitable": { severity: "amber", weight: AMBER_BASE + 9 },
  // repeated-treatments: ≥N treatment/health observations inside a rolling
  // window — a recurring-cost / chronic-illness signal.
  "repeated-treatments": { severity: "amber", weight: AMBER_BASE + 10 },
} as const satisfies Record<string, ReasonMeta>;

export type ReasonId = keyof typeof REASON_REGISTRY;

/** Ordered list of every registered reason id (stable iteration order). */
export const REASON_IDS = Object.keys(REASON_REGISTRY) as ReasonId[];

/** Build a self-contained `Reason` (id + severity + weight) from a registry id. */
export function reasonMeta(id: ReasonId): Reason {
  const meta = REASON_REGISTRY[id];
  return { id, severity: meta.severity, weight: meta.weight };
}
