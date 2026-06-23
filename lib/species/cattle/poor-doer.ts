/**
 * lib/species/cattle/poor-doer.ts — the pure per-animal poor-doer detector.
 *
 * Extracted verbatim from the inline block in `cattleModule.getAlerts`
 * (lib/species/cattle/index.ts) so a SINGLE detection feeds two projections:
 *
 *   - the aggregate dashboard alert ("N animals with low ADG") — getAlerts
 *     now COUNTs `detectPoorDoers(...).length`, byte-identical to before;
 *   - Herd Triage — consumes the per-animal `animalId` list as findings.
 *
 * This is the group-by-animal/group-by-count split applied to ONE detection,
 * the same shape ADR-0005 used for camp alerts. Behaviour is identical to the
 * old inline code: long-run ADG = (last − first) / days over the animal's
 * full weighing history; flagged when ADG < threshold; needs ≥2 readings and
 * a positive elapsed span.
 *
 * PURE: takes already-fetched weighing observations, returns animalIds.
 */

import { parseWeighingMassKg } from "@/lib/domain/observations/weighing-mass";

export interface WeighingObs {
  animalId: string | null;
  observedAt: Date;
  details: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Return the animalIds whose long-run average daily gain is below
 * `adgThreshold`. Order-independent: readings are sorted chronologically per
 * animal, then first vs last are compared (matching the old getAlerts code,
 * which relied on an `orderBy: observedAt asc` query — sorting here makes the
 * helper correct regardless of input order).
 */
export function detectPoorDoers(
  weighingObs: readonly WeighingObs[],
  adgThreshold: number,
): string[] {
  const byAnimal = new Map<string, { date: Date; weightKg: number }[]>();

  for (const obs of weighingObs) {
    if (!obs.animalId) continue;
    // Dual-key weighing mass via the single shared reader: the logger/modal
    // write snake_case `weight_kg`, task-completion weighings persist camelCase
    // `weightKg` — both must count or task-logged animals are silently ignored.
    const weightKg = parseWeighingMassKg(obs.details);
    if (weightKg === null) continue;
    const existing = byAnimal.get(obs.animalId) ?? [];
    existing.push({ date: obs.observedAt, weightKg });
    byAnimal.set(obs.animalId, existing);
  }

  const poorDoers: string[] = [];
  for (const [animalId, readings] of byAnimal) {
    if (readings.length < 2) continue;
    const sorted = [...readings].sort((a, b) => a.date.getTime() - b.date.getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const days = (last.date.getTime() - first.date.getTime()) / MS_PER_DAY;
    if (days <= 0) continue;
    const longRunAdg = (last.weightKg - first.weightKg) / days;
    if (longRunAdg < adgThreshold) poorDoers.push(animalId);
  }

  return poorDoers;
}
