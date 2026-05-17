/**
 * Typed error code for #28 Phase B cross-species hard-block. The API layer
 * maps this onto an HTTP 422 with `{ error: "CROSS_SPECIES_BLOCKED" }`.
 *
 * Spec: each species (cattle/sheep/game) is a fully-isolated workspace inside
 * one tenant. A cattle mob may never sit in a sheep camp; an animal's parent
 * must always be the same species as the child.
 *
 * The invariant is shared: the mobs camp-guard (`lib/domain/mobs/move-mob`)
 * and the animals parent-guard (`lib/domain/animals/update-animal`) both
 * throw it. It encodes the species registry's isolation guarantee, so it
 * lives with the species concept rather than inside any one domain (#315).
 */
export const CROSS_SPECIES_BLOCKED = "CROSS_SPECIES_BLOCKED";

export class CrossSpeciesBlockedError extends Error {
  readonly code = CROSS_SPECIES_BLOCKED;
  readonly mobSpecies: string | null;
  readonly campSpecies: string | null;

  constructor(mobSpecies: string | null, campSpecies: string | null) {
    super(CROSS_SPECIES_BLOCKED);
    this.name = "CrossSpeciesBlockedError";
    this.mobSpecies = mobSpecies;
    this.campSpecies = campSpecies;
  }
}
