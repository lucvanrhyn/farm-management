// lib/server/breeding/constants.ts
// Tunable constants for breeding analytics that are species-INDEPENDENT.
//
// Phase F: gestation period and high-birth-weight threshold moved to
// `lib/species/breeding-constants.ts` so the breeding flow can serve
// cattle, sheep, and game without hardcoded cattle defaults. Constants
// below are common to every species (algorithmic limits, COI cutoffs).

export const MAX_PAIRINGS = 30;
export const COI_HARD_LIMIT = 0.0625; // 6.25% — skip entirely
export const COI_SOFT_LIMIT = 0.03125; // 3.125% — start penalizing
export const MAX_PEDIGREE_DEPTH = 3;
