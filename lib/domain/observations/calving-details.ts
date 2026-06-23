// lib/domain/observations/calving-details.ts
//
// SINGLE source of truth for reading a birth observation's outcome (calving /
// lambing / fawning). Births are persisted under TWO key conventions because
// two write paths build the `details` JSON independently:
//   - the dedicated Calving/Lambing tile (components/logger/CalvingForm.tsx →
//     lib/logger-actions.ts submitCalvingObservation) → camelCase:
//       { calfAlive: boolean, calfAnimalId: <tag>, birthWeight, calvingDifficulty }
//   - the ReproductionForm calving sub-flow (components/logger/ReproductionForm.tsx)
//     → snake_case: { calf_status: "live"|"stillborn", calf_tag: <tag> }
//
// A reader that knows only `calf_status === "live"` silently drops EVERY birth
// logged through the dedicated tile (the primary path) — so calving/birth rate,
// weaning rate, the Einstein herd snapshot, and the reproduction timeline all
// under-count live births. This module is the one place that knows both
// conventions; every reader delegates here.

type Details = Record<string, unknown> | null | undefined;

function firstNonEmptyString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function firstFiniteNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === "number") {
      if (Number.isFinite(v)) return v;
    } else if (typeof v === "string" && v.trim().length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * True when the birth produced a live offspring. The dedicated tile records a
 * boolean `calfAlive`; the ReproductionForm sub-flow (and any legacy/game row)
 * records a `*_status` string that equals "live". A record carrying neither is
 * treated as not-live (unchanged from the historical `calf_status === "live"`).
 */
export function isLiveBirth(details: Details): boolean {
  if (!details) return false;
  if (typeof details.calfAlive === "boolean") return details.calfAlive;
  const status =
    details.calf_status ??
    details.offspring_status ??
    details.lamb_status ??
    details.fawn_status;
  return status === "live";
}

/**
 * The offspring's ear tag. The dedicated tile writes `calfAnimalId`; older /
 * ReproductionForm rows use a snake_case `*_tag`. Returns null when absent.
 */
export function offspringTag(details: Details): string | null {
  if (!details) return null;
  return firstNonEmptyString(
    details.calfAnimalId,
    details.calf_animal_id,
    details.calf_id,
    details.calf_tag,
    details.lamb_tag,
    details.fawn_tag,
    details.offspring_tag,
  );
}

/** Birth weight (kg) — dual-key `birthWeight` (tile) / `birth_weight` (legacy). */
export function birthWeightKg(details: Details): number | null {
  if (!details) return null;
  return firstFiniteNumber(details.birthWeight, details.birth_weight);
}

/** Calving difficulty score — dual-key `calvingDifficulty` / `calving_difficulty`. */
export function calvingDifficulty(details: Details): number | null {
  if (!details) return null;
  return firstFiniteNumber(details.calvingDifficulty, details.calving_difficulty);
}
