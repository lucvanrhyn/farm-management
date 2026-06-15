/**
 * lib/server/triage/project.ts — the group-by-ANIMAL projection.
 *
 * This is the Triage counterpart to `composeAlerts`' group-by-REASON
 * collapse (lib/server/alerts/compose.ts). Both consume the SAME underlying
 * per-animal detections:
 *
 *   composeAlerts:        findings ──group by reason──► "3 animals low ADG"
 *   projectAttentionItems: findings ──group by animal──► [animal a1: 2 reasons]
 *
 * Keeping them as two projections of one detection is the invariant the
 * same-population test locks in (lib/server/triage/__tests__/same-population.test.ts).
 *
 * PURE + TOTAL + DETERMINISTIC: same findings → same ranked output, no I/O,
 * no clock read. Detection + ranking are fully offline by design.
 */

import type { AttentionItem, Finding, Reason, ReasonSeverity } from "./types";
import { REASON_REGISTRY, type ReasonId } from "./reasons";

function isKnownReason(id: string): id is ReasonId {
  return Object.prototype.hasOwnProperty.call(REASON_REGISTRY, id);
}

/**
 * Group a flat list of per-animal findings into one ranked `AttentionItem`
 * per animal.
 *
 * Ranking (mirrors the locked scope decision):
 *   1. urgency DESC  (urgency = Σ reason.weight)
 *   2. reason COUNT DESC
 *   3. animalId ASC  (stable final tie-break — same population → same order)
 *
 * Findings with an unknown reasonId are dropped defensively (a detector that
 * emits a reason not in the registry would otherwise produce a 0-weight,
 * severity-less item). Duplicate (animalId, reasonId) pairs collapse to one.
 */
export function projectAttentionItems(findings: readonly Finding[]): AttentionItem[] {
  // animalId → { species, reasonIds set }
  const byAnimal = new Map<
    string,
    { species: Finding["species"]; reasonIds: Set<ReasonId> }
  >();

  for (const finding of findings) {
    if (!isKnownReason(finding.reasonId)) continue;
    const existing = byAnimal.get(finding.animalId);
    if (existing) {
      existing.reasonIds.add(finding.reasonId);
    } else {
      byAnimal.set(finding.animalId, {
        species: finding.species,
        reasonIds: new Set<ReasonId>([finding.reasonId]),
      });
    }
  }

  const items: AttentionItem[] = [];
  for (const [animalId, { species, reasonIds }] of byAnimal) {
    const reasons: Reason[] = [...reasonIds].map((id) => {
      const meta = REASON_REGISTRY[id];
      return { id, severity: meta.severity, weight: meta.weight };
    });
    const urgency = reasons.reduce((sum, r) => sum + r.weight, 0);
    const severity: ReasonSeverity = reasons.some((r) => r.severity === "red")
      ? "red"
      : "amber";
    items.push({ animalId, reasons, urgency, severity, species });
  }

  // Stable ranking: urgency DESC, then reason count DESC, then animalId ASC.
  items.sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length;
    return a.animalId < b.animalId ? -1 : a.animalId > b.animalId ? 1 : 0;
  });

  return items;
}
