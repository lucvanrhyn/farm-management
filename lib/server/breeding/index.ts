// lib/server/breeding/index.ts
// Public API surface for breeding analytics. Importers should use either
// `@/lib/server/breeding` (this file) or the legacy
// `@/lib/server/breeding-analytics` re-export shim.

export type {
  BreedingSnapshot,
  InbreedingRisk,
  TraitProfile,
  PairingSuggestion,
  PairingResult,
  PairingEmptyReason,
  AnimalRow,
} from "./types";

export { getBreedingSnapshot } from "./snapshot";
export { detectInbreedingRisk, calculateCOI } from "./inbreeding";
export { getAnimalTraitProfile } from "./trait-profile";
export { suggestPairings } from "./pairings";
