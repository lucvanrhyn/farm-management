/**
 * lib/server/triage/narrate.ts — deterministic OFFLINE prose for Triage.
 *
 * Built on the shared narration primitives (lib/server/narration/
 * templated-fallback.ts). PURE + TOTAL: same item(s) → same prose, no I/O,
 * no clock read. Detection + ranking are fully offline; this is the prose
 * layer for the offline path (an online Einstein one-liner is OPTIONAL and
 * lives at the call site — it falls back to these strings on no-key/error).
 *
 * Grounding rule (mirrors Einstein's): NEVER mention a reason an item does
 * not carry. The per-reason phrase map is keyed by ReasonId and only the
 * item's own reasons are rendered.
 */

import type { AttentionItem } from "./types";
import { joinClauses, pluralize } from "@/lib/server/narration/templated-fallback";
import type { ReasonId } from "./reasons";

/**
 * Short, farmer-friendly clause per reason. Used inside a sentence:
 * "COW-12 has no camp assigned and no recorded date of birth." Phrases are
 * lower-case sentence fragments so they compose via `joinClauses`.
 */
const REASON_PHRASES: Record<ReasonId, string> = {
  "no-camp": "no camp assigned",
  "missing-id": "no ear-tag or brand on record",
  "missing-dob": "no recorded date of birth",
  "age-for-category": "an age that doesn't match its category",
  "no-weight-on-record": "no weighing on record",
  "poor-doer": "low weight gain (poor doer)",
  "dosing-overdue": "dosing overdue",
  "in-withdrawal": "an open drug-withdrawal period",
};

function phraseFor(reasonId: string): string {
  return REASON_PHRASES[reasonId as ReasonId] ?? reasonId;
}

/**
 * One-line prose for a single attention item. Names the animal and lists
 * exactly the reasons it carries (reason order follows the item's reasons
 * array, which `project.ts` builds deterministically).
 */
export function narrateTriageItem(item: AttentionItem): string {
  const clauses = item.reasons.map((r) => phraseFor(r.id));
  const list = joinClauses(clauses);
  const lead = item.severity === "red" ? "Act now" : "Attend soon";
  return `${lead}: ${item.animalId} has ${list}.`;
}

/**
 * Herd-at-a-glance summary across the ranked items. Reports the total number
 * of animals needing attention and how many are urgent (red).
 */
export function narrateHerdGlance(items: readonly AttentionItem[]): string {
  if (items.length === 0) {
    return "All clear — no animals need attention right now.";
  }
  const urgent = items.filter((i) => i.severity === "red").length;
  const total = pluralize(items.length, "animal");
  const verb = items.length === 1 ? "needs" : "need";
  const urgentClause = urgent > 0 ? ` — ${pluralize(urgent, "is urgent", "are urgent")}` : "";
  return `${total} ${verb} attention${urgentClause}.`;
}
