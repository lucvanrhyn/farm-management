/**
 * Wave C (#156) — domain op `createObservation`.
 *
 * Persists an observation after enforcing:
 *   - Type allowlist (defends against arbitrary type strings landed via
 *     compromised offline-sync clients).
 *   - Parseable `created_at` (when supplied).
 *   - Camp existence (Phase A of #28: campId is no longer globally
 *     unique under the composite UNIQUE on `(species, campId)`, so a
 *     `findFirst` is single-species-safe — Phase B will scope when the
 *     route surface gets the species context).
 *
 * Phase I.3 — when `animal_id` is supplied, denormalises `Animal.species`
 * onto the observation row so admin filters can scope by species
 * without a join. Orphaned/camp-only observations carry `species: null`.
 */
import type { PrismaClient } from "@prisma/client";

import {
  CampNotFoundError,
  InvalidTimestampError,
  InvalidTypeError,
} from "./errors";

/** Allowlist of valid observation type strings. */
export const VALID_OBSERVATION_TYPES: ReadonlySet<string> = new Set([
  "camp_condition",
  "camp_check",
  "calving",
  "pregnancy_scan",
  "weighing",
  "treatment",
  "heat_detection",
  "insemination",
  "drying_off",
  "weaning",
  "death",
  "mob_movement",
  "general",
  "dosing",
  "shearing",
  "lambing",
  "game_census",
  "game_sighting",
]);

export interface CreateObservationInput {
  type: string;
  camp_id: string;
  animal_id?: string | null;
  details?: string | null;
  created_at?: string | null;
  /** Email of the actor — captured on the audit trail. */
  loggedBy: string | null;
}

export interface CreateObservationResult {
  success: true;
  id: string;
}

export async function createObservation(
  prisma: PrismaClient,
  input: CreateObservationInput,
): Promise<CreateObservationResult> {
  if (!VALID_OBSERVATION_TYPES.has(input.type)) {
    throw new InvalidTypeError(input.type);
  }

  let observedAt: Date;
  if (input.created_at) {
    const parsed = new Date(input.created_at);
    if (Number.isNaN(parsed.getTime())) {
      throw new InvalidTimestampError(input.created_at);
    }
    observedAt = parsed;
  } else {
    observedAt = new Date();
  }

  const campExists = await prisma.camp.findFirst({
    where: { campId: input.camp_id },
    select: { campId: true },
  });
  if (!campExists) {
    throw new CampNotFoundError(input.camp_id);
  }

  // Phase I.3 — denormalise species onto Observation at write time so
  // /admin/reproduction can filter `species: mode` directly (no animalId-IN
  // prefetch). Nullable: orphan/camp-only observations have no species.
  let species: string | null = null;
  if (input.animal_id) {
    const animal = await prisma.animal.findUnique({
      where: { animalId: input.animal_id },
      select: { species: true },
    });
    species = animal?.species ?? null;
  }

  const record = await prisma.observation.create({
    data: {
      type: input.type,
      campId: input.camp_id,
      animalId: input.animal_id ?? null,
      details: input.details ?? "",
      observedAt,
      loggedBy: input.loggedBy,
      species,
    },
  });

  return { success: true, id: record.id };
}
