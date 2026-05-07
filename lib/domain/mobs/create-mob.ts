/**
 * Wave B (#151) — domain op `createMob`.
 *
 * Validates the destination camp's species via `requireSpeciesScopedCamp`
 * (PR #123 / #97 fix) before creating the mob. Throws typed errors that
 * the adapter envelope maps onto the existing 422 wire shape. Legacy
 * orphaned rows where `camp.species` is null are treated as a different
 * species per the multi-species spec.
 */
import type { PrismaClient } from "@prisma/client";

import { isValidSpecies } from "@/lib/species/registry";
import { requireSpeciesScopedCamp } from "@/lib/server/species/require-species-scoped-camp";
import type { SpeciesId } from "@/lib/species/types";
import { RouteValidationError } from "@/lib/server/route";

import { NotFoundError, WrongSpeciesError } from "./errors";

export interface CreateMobInput {
  name: string;
  currentCamp: string;
  species: SpeciesId;
  /** Tenant slug — passed through to `requireSpeciesScopedCamp` for audit. */
  farmSlug: string;
}

export interface CreateMobResult {
  id: string;
  name: string;
  current_camp: string;
  animal_count: number;
}

/**
 * Validate input shape — name + currentCamp + species are all required.
 * Surfaces field-level errors via `RouteValidationError` so the adapter
 * lands a `{ error: "VALIDATION_FAILED", message, details: { fieldErrors } }`
 * envelope.
 */
function validate(input: CreateMobInput): void {
  const errors: Record<string, string> = {};
  if (!input.name) errors.name = "name is required";
  if (!input.currentCamp) errors.currentCamp = "currentCamp is required";
  if (!input.species || !isValidSpecies(input.species)) {
    errors.species = "species is required (cattle | sheep | game)";
  }
  if (Object.keys(errors).length > 0) {
    throw new RouteValidationError(
      Object.values(errors)[0] ?? "Invalid body",
      { fieldErrors: errors },
    );
  }
}

export async function createMob(
  prisma: PrismaClient,
  input: CreateMobInput,
): Promise<CreateMobResult> {
  validate(input);

  // #97 — Hard-block orphan + cross-species moves at create time. The
  // composite-unique lookup is deterministic when the same campId exists
  // for multiple species (Phase A of #28).
  const campCheck = await requireSpeciesScopedCamp(prisma, {
    species: input.species,
    farmSlug: input.farmSlug,
    campId: input.currentCamp,
  });
  if (!campCheck.ok) {
    if (campCheck.reason === "WRONG_SPECIES") throw new WrongSpeciesError();
    throw new NotFoundError();
  }

  const mob = await prisma.mob.create({
    data: {
      name: input.name,
      currentCamp: input.currentCamp,
      species: input.species,
    },
  });

  return {
    id: mob.id,
    name: mob.name,
    current_camp: mob.currentCamp,
    animal_count: 0,
  };
}
