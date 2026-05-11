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
  "animal_movement",
  "health_issue",
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
  /**
   * Issue #206 — client-generated UUID for idempotent retries. The Logger
   * forms generate this at mount via `crypto.randomUUID()`; the offline-sync
   * queue replays it verbatim on retry. When supplied, the domain op upserts
   * on this column so a retried submit returns the existing observation's
   * id (200, not 409, not duplicate row). Omitting it falls back to the
   * legacy create path — back-compat for callers that pre-date #206.
   */
  clientLocalId?: string | null;
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

  // Issue #206 — idempotent write path. When the client supplies a UUID, route
  // through `upsert` so a retry returns the original row instead of creating a
  // duplicate. The `update: {}` is intentional: the observation contents at
  // first-write time are canonical; a retry with a tweaked `details` must NOT
  // silently mutate the persisted row (audit trail integrity). The race between
  // SELECT-then-INSERT lives in `create` — `upsert` against the UNIQUE index
  // (`idx_observation_client_local_id`, migration 0019) collapses concurrent
  // retries down to a single row at the DB layer.
  if (input.clientLocalId) {
    const record = await prisma.observation.upsert({
      where: { clientLocalId: input.clientLocalId },
      update: {},
      create: {
        type: input.type,
        campId: input.camp_id,
        animalId: input.animal_id ?? null,
        details: input.details ?? "",
        observedAt,
        loggedBy: input.loggedBy,
        species,
        clientLocalId: input.clientLocalId,
      },
    });
    return { success: true, id: record.id };
  }

  // Legacy fallback (no idempotency promise). Callers that pre-date #206 —
  // including the back-compat path for any server-side create that has no
  // client UUID in scope — keep the original behaviour.
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
