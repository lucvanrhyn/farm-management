// lib/server/breeding/constants.ts
// Tunable constants for breeding analytics.

export const GESTATION_DAYS = 285;
export const MAX_PAIRINGS = 30;
export const COI_HARD_LIMIT = 0.0625; // 6.25% — skip entirely
export const COI_SOFT_LIMIT = 0.03125; // 3.125% — start penalizing
export const HIGH_BIRTH_WEIGHT_KG = 38;
export const MAX_PEDIGREE_DEPTH = 3;
