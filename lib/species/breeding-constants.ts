// lib/species/breeding-constants.ts
//
// Phase F — per-species constants for breeding-analytics
// (`lib/server/breeding/{snapshot,pairings,scoring}.ts`).
//
// Before this module the breeding analytics layer hardcoded cattle values:
// 285d gestation, "Bull" / "Cow" / "Heifer" categories, and a 38 kg
// high-birth-weight calf threshold. Calling the analytics for `species="sheep"`
// or `species="game"` either returned empty results (because of a hardcoded
// `where: { species: "cattle" }` filter) or — once that filter was lifted —
// produced nonsense numbers because rams/ewes never matched "Bull" or "Cow".
//
// This module is intentionally tiny: a per-species lookup of the half-dozen
// values the analytics layer needs. Callers (snapshot, pairings, scoring)
// derive every species-specific decision from the returned record. Unknown
// species throw `UnknownBreedingSpeciesError` — silent fallback to cattle is
// the bug we are paying off.
//
// Sources:
//   Cattle 285d:    lib/species/cattle/config.ts (CATTLE_CONFIG.gestationDays)
//   Sheep 150d:     lib/species/sheep/config.ts  (SHEEP_CONFIG.gestationDays)
//   Game (kudu):    240d — Wikipedia (Greater kudu); see lib/species/gestation.ts
//                   for the per-breed table. Kudu is a representative SA bushveld
//                   antelope — conservative middle-of-range vs warthog (172) and
//                   eland/gemsbok (270). Documented as a placeholder until game
//                   farms get a per-game-species breeding flow (Phase O+).
//   High birth weight thresholds: cattle 38 kg matches the original constant
//   (lib/server/breeding/constants.ts → HIGH_BIRTH_WEIGHT_KG). Sheep lambs are
//   ~5 kg avg — 7 kg flags an oversized lamb, the classic dystocia trigger.
//   Game thresholds are not used in practice (game herds skip the heifer-safety
//   penalty path) but we set a sane non-zero placeholder so no downstream
//   division ever yields NaN.

import type { SpeciesId } from "./types";

export interface BreedingConstants {
  /** Days from successful service to expected parturition. */
  gestationDays: number;
  /** Animal category that represents an adult breeding male (e.g. "Bull"). */
  sireCategory: string;
  /** Animal categories that represent breeding females (e.g. ["Cow", "Heifer"]). */
  femaleCategories: readonly string[];
  /** The "young female" category that triggers heifer-style birth-weight safety penalties. */
  youngFemaleCategory: string;
  /** Birth weight (kg) above which the sire is flagged risky for young dams. */
  highBirthWeightKg: number;
}

export class UnknownBreedingSpeciesError extends Error {
  readonly code = "UNKNOWN_BREEDING_SPECIES" as const;
  constructor(species: string) {
    super(`Unknown breeding species: ${JSON.stringify(species)}`);
    this.name = "UnknownBreedingSpeciesError";
  }
}

const TABLE: Record<SpeciesId, BreedingConstants> = {
  cattle: {
    gestationDays: 285,
    sireCategory: "Bull",
    femaleCategories: ["Cow", "Heifer"],
    youngFemaleCategory: "Heifer",
    highBirthWeightKg: 38,
  },
  sheep: {
    gestationDays: 150,
    sireCategory: "Ram",
    femaleCategories: ["Ewe", "Maiden Ewe", "Ewe Lamb"],
    youngFemaleCategory: "Maiden Ewe",
    highBirthWeightKg: 7,
  },
  game: {
    // Kudu-class default. Game farms use population-tracking — individual
    // pairing analytics is a placeholder shape, but the numbers must be
    // finite so consumers never see NaN/Infinity.
    gestationDays: 240,
    sireCategory: "Adult Male",
    femaleCategories: ["Adult Female", "Sub-adult"],
    youngFemaleCategory: "Sub-adult",
    highBirthWeightKg: 12,
  },
};

/**
 * Look up breeding constants for a species. Throws
 * `UnknownBreedingSpeciesError` if the species is not in the table.
 *
 * Callers should treat this as the single source of truth — never reach
 * into the underlying TABLE directly, and never silently fall back to
 * cattle values when validation fails.
 */
export function getBreedingConstants(species: SpeciesId): BreedingConstants {
  const entry = TABLE[species];
  if (!entry) {
    throw new UnknownBreedingSpeciesError(String(species));
  }
  return entry;
}
