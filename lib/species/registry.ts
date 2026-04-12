// lib/species/registry.ts — Species module registry

import type {
  SpeciesId,
  SpeciesConfig,
  SpeciesModule,
  ObservationTypeDef,
} from "./types";
import { SHARED_OBSERVATION_TYPES } from "./types";
import { cattleModule } from "./cattle";
import { sheepModule } from "./sheep";
import { gameModule } from "./game";

const MODULES: Record<SpeciesId, SpeciesModule> = {
  cattle: cattleModule,
  sheep: sheepModule,
  game: gameModule,
};

/**
 * Get a species module by ID. Throws if species is unknown.
 */
export function getSpeciesModule(species: SpeciesId): SpeciesModule {
  const mod = MODULES[species];
  if (!mod) throw new Error(`Unknown species: ${species}`);
  return mod;
}

/**
 * Get all species configs (for rendering species tabs, etc.).
 */
export function getAllSpeciesConfigs(): SpeciesConfig[] {
  return Object.values(MODULES).map((m) => m.config);
}

/**
 * Get species configs for enabled species on a farm.
 */
export function getEnabledSpecies(
  farmSpeciesSettings: ReadonlyArray<{ species: string; enabled: boolean }>,
): SpeciesId[] {
  return farmSpeciesSettings
    .filter((s) => s.enabled)
    .map((s) => s.species as SpeciesId)
    .filter((id) => id in MODULES);
}

/**
 * Check if a species ID is valid.
 */
export function isValidSpecies(species: string): species is SpeciesId {
  return species in MODULES;
}

/**
 * Get all observation types available for a species (shared + species-specific).
 */
export function getObservationTypesForSpecies(species: SpeciesId): ObservationTypeDef[] {
  const mod = MODULES[species];
  if (!mod) return [...SHARED_OBSERVATION_TYPES];
  return [...SHARED_OBSERVATION_TYPES, ...mod.config.observationTypes];
}

/**
 * Get all observation types across all species (for forms that don't know species yet).
 */
export function getAllObservationTypes(): ObservationTypeDef[] {
  const all = [...SHARED_OBSERVATION_TYPES];
  for (const mod of Object.values(MODULES)) {
    all.push(...mod.config.observationTypes);
  }
  // Deduplicate by value
  const seen = new Set<string>();
  return all.filter((t) => {
    if (seen.has(t.value)) return false;
    seen.add(t.value);
    return true;
  });
}

/**
 * Get LSU values for a species, with optional farm-level overrides.
 */
export function getLsuValuesForSpecies(
  species: SpeciesId,
  farmOverrides?: Record<string, number>,
): Record<string, number> {
  return getSpeciesModule(species).getLsuValues(farmOverrides);
}

/**
 * Get merged LSU values across ALL species.
 * Used for mixed-camp calculations where cattle, sheep, and game share a camp.
 * Category names are unique across species (Cow, Ewe, Adult Male, etc.) so no collisions.
 */
export function getMergedLsuValues(): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const mod of Object.values(MODULES)) {
    Object.assign(merged, mod.config.defaultLsuValues);
  }
  return merged;
}
