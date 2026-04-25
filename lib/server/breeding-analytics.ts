// lib/server/breeding-analytics.ts
//
// Legacy re-export shim. The implementation lives under `lib/server/breeding/`
// (snapshot.ts, inbreeding.ts, trait-profile.ts, scoring.ts, pairings.ts).
// Existing import paths keep working unchanged.

export type {
  BreedingSnapshot,
  InbreedingRisk,
  TraitProfile,
  PairingSuggestion,
  PairingResult,
  PairingEmptyReason,
  AnimalRow,
} from "./breeding/types";

export { getBreedingSnapshot } from "./breeding/snapshot";
export { detectInbreedingRisk, calculateCOI } from "./breeding/inbreeding";
export { getAnimalTraitProfile } from "./breeding/trait-profile";
export { suggestPairings } from "./breeding/pairings";
