// lib/server/breeding/types.ts
// Public types for the breeding-analytics module family.

export interface BreedingSnapshot {
  bullsInService: number;
  pregnantCows: number;
  openCows: number;
  expectedCalvingsThisMonth: number;
  calendarEntries: Array<{
    animalId: string;
    animalTag: string;
    expectedDate: string;
  }>;
}

export interface InbreedingRisk {
  animalId: string;
  tag: string;
  riskType: "parent_offspring" | "sibling" | "shared_grandparent";
  relatedAnimalId: string;
  relatedTag: string;
}

export interface TraitProfile {
  birthWeight: number | null;
  calvingDifficultyAvg: number | null;
  bcsLatest: number | null;
  temperamentLatest: number | null;
  scrotalCirc: number | null;
  offspringCount: number;
}

export interface PairingSuggestion {
  bullId: string;
  bullTag: string;
  cowId: string;
  cowTag: string;
  score: number;
  coi: number;
  reason: string;
  riskFlags: string[];
  traitBreakdown?: {
    growth: number | null;
    fertility: number | null;
    calvingEase: number | null;
    temperament: number | null;
  };
}

/**
 * Result envelope for suggestPairings.
 *
 * Why not just return PairingSuggestion[]?
 *
 * When a farm has animals but zero pedigree (no animal records a fatherId or
 * motherId), every pairing has COI = 0 by construction. The old code silently
 * returned the full cartesian product (e.g. 33,656 pairings at 0.0% COI),
 * which presents as a feature but is really a "no data" bug. Distinguishing
 * the NO_PEDIGREE_SEED case lets the page render a proper empty-state that
 * points the farmer at the pedigree importer, instead of firehosing junk.
 */
export type PairingEmptyReason = "NO_PEDIGREE_SEED" | "NO_BULLS" | "NO_OPEN_COWS";

export interface PairingResult {
  pairings: PairingSuggestion[];
  reason?: PairingEmptyReason;
}

export interface AnimalRow {
  id: string;
  animalId: string;
  sex: string;
  category: string;
  status: string;
  motherId: string | null;
  fatherId: string | null;
}
