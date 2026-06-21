/**
 * lib/server/triage/types.ts — the Herd Triage v1 read model.
 *
 * ──────────────────────────────────────────────────────────────────────
 * What Triage is
 * ──────────────────────────────────────────────────────────────────────
 * The dashboard alert system (`lib/server/alerts/compose.ts`) answers
 * "what's wrong on the farm?" by collapsing per-animal findings into
 * aggregate COUNTS ("3 animals with low ADG"). Triage answers the
 * complementary question "which ANIMAL should I look at first?" — it is the
 * group-by-ANIMAL projection of the SAME underlying detections that alerts
 * collapse group-by-REASON.
 *
 * An `AttentionItem` is one animal that has one or more reasons it needs a
 * human's attention, ranked by an urgency score.
 *
 * Scope (v1): CATTLE + SHEEP only. Game is census/population-tracked
 * (`SpeciesConfig.trackingMode === "population"`) — there is no per-animal
 * row to triage, so game is excluded by construction (no per-animal game
 * path exists).
 */

import type { SpeciesId } from "@/lib/species/types";

/** Severity of a reason / item. `red` = act now; `amber` = attend soon. */
export type ReasonSeverity = "red" | "amber";

/**
 * One reason an animal needs attention. `id` keys into REASON_REGISTRY
 * (`lib/server/triage/reasons.ts`); `severity` + `weight` are copied from
 * the registry at projection time so an item is self-contained for the UI
 * and for narration (no registry lookup needed downstream).
 */
export interface Reason {
  id: string;
  severity: ReasonSeverity;
  weight: number;
}

/**
 * One animal flagged for attention, with every reason it carries.
 *
 * - `urgency`  = Σ reason.weight (higher = sooner). NET-NEW to Triage.
 * - `severity` = max reason severity (ANY red ⇒ red).
 *
 * Ranking (computed in `project.ts`): urgency DESC, then reason COUNT DESC,
 * then animalId ASC (stable, deterministic — same population → same order).
 */
export interface AttentionItem {
  animalId: string;
  reasons: Reason[];
  urgency: number;
  severity: ReasonSeverity;
  species: SpeciesId;
  /**
   * Optional informational note that the item carries a PROJECTED / advisory
   * flag (e.g. `unprofitable` computed on the unsold active roster's margin,
   * not a banked realised loss). Surfaced as a small "(advisory)" tag in the
   * UI. Optional so existing fixtures and the firm reasons omit it.
   */
  advisory?: string;
}

/** A raw per-animal finding emitted by a detector, before projection. */
export interface Finding {
  animalId: string;
  reasonId: string;
  species: SpeciesId;
  /**
   * Optional advisory note for a projected/estimate-based finding. Carried
   * through projection onto the matching `AttentionItem`. Optional so the
   * firm detectors (and every existing test fixture) need not set it.
   */
  advisory?: string;
}
