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

import { crossSpecies } from "@/lib/server/species-scoped-prisma";

import {
  CampNotFoundError,
  InvalidTimestampError,
  InvalidTypeError,
} from "./errors";
import { OBSERVATION_TYPES } from "./registry";

/**
 * Allowlist of valid observation type strings.
 *
 * #319 — derived from the single source of truth in `./registry` so the
 * persistence allowlist can never again drift from the UI enum / server
 * validators. The original export name + `ReadonlySet<string>` shape is kept
 * so every downstream importer compiles unchanged.
 */
export const VALID_OBSERVATION_TYPES: ReadonlySet<string> = OBSERVATION_TYPES;

/** Wire code for {@link CampConditionFieldRequiredError}. */
export const CAMP_CONDITION_FIELD_REQUIRED =
  "CAMP_CONDITION_FIELD_REQUIRED" as const;

/**
 * Issue #321 (PRD #318 stress-test remediation, wave R4).
 *
 * A `camp_condition` observation reached the write boundary without an
 * explicit grazing / water / fence reading. The pre-#321 `CampConditionForm`
 * pre-selected "Good" / "Full" / "Intact" and left Submit permanently
 * enabled, so a zero-interaction (or stale-offline-queued) submit persisted
 * those defaults as the farmer's *answer* — a clean inspection
 * indistinguishable from a deliberate all-good one. The client now emits
 * unselected sentinels, but a stale client can still POST an incomplete
 * payload; this server-side guard rejects it instead of silently writing an
 * implicit reading.
 *
 * `field` names the first missing/blank selection so the caller can surface
 * a precise message rather than a generic 500. It is co-located here (rather
 * than in `./errors`) because the guard itself is `camp_condition`-specific
 * and lives in this domain op; it carries its own SCREAMING_SNAKE `code` so
 * the API error mapper / offline-sync queue can react to it like every other
 * typed observation error.
 */
export class CampConditionFieldRequiredError extends Error {
  readonly code = CAMP_CONDITION_FIELD_REQUIRED;
  readonly field: "grazing" | "water" | "fence";
  constructor(field: "grazing" | "water" | "fence") {
    super(`camp_condition observation is missing required field: ${field}`);
    this.name = "CampConditionFieldRequiredError";
    this.field = field;
  }
}

/**
 * The required camp_condition selection keys, in the order the farmer
 * answers them in `CampConditionForm`. The persisted `details` payload is
 * `JSON.stringify({ grazing, water, fence, logged_by })` (see the Logger
 * page's `handleConditionSubmit`), so these are the camelCase-free keys to
 * assert on.
 */
const CAMP_CONDITION_REQUIRED_FIELDS = ["grazing", "water", "fence"] as const;

/**
 * Throws {@link CampConditionFieldRequiredError} unless `details` parses to
 * an object carrying a non-blank value for every required field. Defends
 * against: empty/absent details, malformed JSON, an omitted key, and an
 * explicit `null`/empty-string sentinel (the shape the #321 client now emits
 * for an unanswered group).
 */
function assertCampConditionComplete(details: string | null | undefined): void {
  let parsed: unknown;
  try {
    parsed = details ? JSON.parse(details) : null;
  } catch {
    parsed = null;
  }
  const obj =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  for (const field of CAMP_CONDITION_REQUIRED_FIELDS) {
    const value = obj[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new CampConditionFieldRequiredError(field);
    }
  }
}

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

  // Issue #321 — required-field guard for camp_condition. Other observation
  // types carry unrelated `details` shapes and are deliberately untouched.
  if (input.type === "camp_condition") {
    assertCampConditionComplete(input.details);
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

  const campExists = await crossSpecies(
    prisma,
    "species-registry-internal",
  ).camp.findFirst({
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
