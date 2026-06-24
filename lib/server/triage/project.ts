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
 *   1. severity TIER  (red before amber) — STRUCTURAL guarantee that any red
 *      animal outranks any all-amber animal, independent of summed urgency
 *   2. urgency DESC  (urgency = Σ reason.weight) — within a severity tier
 *   3. reason COUNT DESC
 *   4. animalId ASC  (stable final tie-break — same population → same order)
 *
 * Severity is the PRIMARY key on purpose. The per-reason weight band
 * (min red weight > max amber weight, reasons.ts) keeps a SINGLE red ahead of
 * a SINGLE amber, but it does NOT bound the SUMMED urgency of a multi-reason
 * amber animal — once an animal stacks enough ambers (e.g. open-cow +
 * unprofitable + repeated-treatments + …), Σ amber weight can exceed a lone
 * red's weight. Sorting on urgency alone would then bury a food-safety /
 * regulatory red (in-withdrawal) below management-signal ambers. Tiering by
 * severity first makes "any red outranks all-amber" hold for any weight table.
 *
 * Findings with an unknown reasonId are dropped defensively (a detector that
 * emits a reason not in the registry would otherwise produce a 0-weight,
 * severity-less item). Duplicate (animalId, reasonId) pairs collapse to one.
 */
export function projectAttentionItems(findings: readonly Finding[]): AttentionItem[] {
  // animalId → { species, reasonIds set, advisory? }
  const byAnimal = new Map<
    string,
    { species: Finding["species"]; reasonIds: Set<ReasonId>; advisory?: string }
  >();

  for (const finding of findings) {
    if (!isKnownReason(finding.reasonId)) continue;
    const existing = byAnimal.get(finding.animalId);
    if (existing) {
      existing.reasonIds.add(finding.reasonId);
      // First advisory note wins; carry it onto the animal's item so a
      // projected/estimate-based finding (e.g. unprofitable) is flagged.
      if (existing.advisory === undefined && finding.advisory !== undefined) {
        existing.advisory = finding.advisory;
      }
    } else {
      byAnimal.set(finding.animalId, {
        species: finding.species,
        reasonIds: new Set<ReasonId>([finding.reasonId]),
        advisory: finding.advisory,
      });
    }
  }

  const items: AttentionItem[] = [];
  for (const [animalId, { species, reasonIds, advisory }] of byAnimal) {
    const reasons: Reason[] = [...reasonIds].map((id) => {
      const meta = REASON_REGISTRY[id];
      return { id, severity: meta.severity, weight: meta.weight };
    });
    const urgency = reasons.reduce((sum, r) => sum + r.weight, 0);
    const severity: ReasonSeverity = reasons.some((r) => r.severity === "red")
      ? "red"
      : "amber";
    items.push(
      advisory !== undefined
        ? { animalId, reasons, urgency, severity, species, advisory }
        : { animalId, reasons, urgency, severity, species },
    );
  }

  // Stable ranking: severity tier (red first), then urgency DESC, then reason
  // count DESC, then animalId ASC. Severity is primary so a red always outranks
  // any all-amber animal regardless of summed urgency (see docstring).
  const SEVERITY_RANK: Record<ReasonSeverity, number> = { red: 0, amber: 1 };
  items.sort((a, b) => {
    if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length;
    return a.animalId < b.animalId ? -1 : a.animalId > b.animalId ? 1 : 0;
  });

  return items;
}
