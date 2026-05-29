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
 * Phase I.3 / ADR-0004 — denormalises species onto the row at write time
 * so admin filters can scope by species without a join.
 *
 * ADR-0006 — this is THE write door. Raw `<writer>.observation.create`
 * is forbidden on any tenant code path (enforced by the structural test
 * `__tests__/architecture/observation-write-no-direct-callers.test.ts`).
 *
 *   - `client` is an `ObservationWriter` (PrismaClient OR the
 *     transaction-callback client returned by `prisma.$transaction`),
 *     so the door works both inline AND inside a `$transaction` block
 *     — the load-bearing case for `lib/domain/mobs/move-mob.ts` and
 *     `lib/domain/tasks/update-task.ts`, which both need the
 *     observation create to be atomic with their sibling mutations.
 *
 *   - Species-stamping waterfall (most-specific source wins):
 *       1. `animal_id` given → animal's species; throws
 *          `AnimalNotFoundError` on FK miss.
 *       2. Else `mob_id` given → mob's species; throws
 *          `MobNotFoundError` on FK miss.
 *       3. Else if the resolved camp carries a species → camp's species.
 *       4. Else → `null`.
 *
 *     The throws on FK miss replace the pre-ADR-0006
 *     `animal?.species ?? null` fallback — a missing animal/mob now
 *     surfaces as a typed error instead of silently producing a
 *     NULL-species row.
 *
 *   - `mob_id` is an INPUT-ONLY field used to drive the waterfall;
 *     `Observation` has no `mobId` column, so it is not persisted on
 *     the row (mob-level provenance lives in the `details` JSON of
 *     mob-typed observations).
 */
import type { PrismaClient, Prisma } from "@prisma/client";

import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { getTenantDayRange } from "@/lib/server/tenant-day";

import { getMaxLiveWeightKg } from "@/lib/species/breeding-constants";
import { validateWeighingObservation } from "@/lib/server/validators/weighing";

import {
  AnimalNotFoundError,
  CampNotFoundError,
  DuplicateObservationError,
  InvalidTimestampError,
  InvalidTypeError,
  MobNotFoundError,
  NoteTooLongError,
} from "./errors";
import { OBSERVATION_TYPES } from "./registry";

/**
 * Issue #492 — maximum length of the free-text `notes` field, measured AFTER
 * trim. Notes are unbounded free text the farmer types on any observation; a
 * cap defends the column against an arbitrarily large blob from a stale /
 * malicious client. 2000 chars comfortably fits the longest realistic field
 * note ("coughing in camp 3", "lame ewe 402, treated with…") while bounding
 * row growth + RAG-chunk cost. Shared by the create door + edit door +
 * wire-schema boundary so the cap is enforced identically at every layer.
 * Exceeding it throws {@link NoteTooLongError} (→ 400 NOTE_TOO_LONG).
 */
export const NOTE_MAX_LENGTH = 2000;

/**
 * Issue #492 — sanitise an optional free-text note for persistence.
 *
 * Trims surrounding whitespace; a note that is absent, null, or blank after
 * trim normalises to `null` (no empty-string rows). A note exceeding
 * {@link NOTE_MAX_LENGTH} (post-trim) throws {@link NoteTooLongError} so the
 * over-length payload is rejected — never silently truncated — at whichever
 * write boundary (create or edit) is in play. The throw routes through the
 * canonical typed-error envelope (`NOTE_TOO_LONG`, 400) via `mapApiDomainError`.
 */
export function sanitizeNote(
  notes: string | null | undefined,
): string | null {
  if (notes == null) return null;
  const trimmed = notes.trim();
  if (trimmed === "") return null;
  if (trimmed.length > NOTE_MAX_LENGTH) {
    throw new NoteTooLongError(NOTE_MAX_LENGTH, trimmed.length);
  }
  return trimmed;
}

/**
 * ADR-0006 — the writer client accepted by {@link createObservation}.
 *
 * `PrismaClient` covers inline writes (route handlers, cron jobs).
 * `Prisma.TransactionClient` is the type Prisma's interactive
 * transaction callback receives — an `Omit<PrismaClient, ...>` with
 * `$transaction`, `$connect`, etc. stripped. Accepting the union lets
 * call sites inside `prisma.$transaction(async (tx) => { ... })` pass
 * `tx` so the observation create stays atomic with sibling mutations.
 *
 * This matches the shape `crossSpecies()` accepts in
 * `lib/server/species-scoped-prisma.ts`, so the internal
 * `crossSpecies(client, ...).camp.findFirst(...)` call below works
 * transparently with either input.
 */
export type ObservationWriter = PrismaClient | Prisma.TransactionClient;

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

/**
 * Issue #366 — rejects a byte-identical duplicate `camp_condition` write.
 *
 * Root cause: the only dedup mechanism is the `clientLocalId` upsert
 * (#206). `clientLocalId` is minted PER FORM MOUNT (`crypto.randomUUID()`
 * in `CampConditionForm`), so the upsert only collapses retries of ONE
 * submission. Two separate camp-condition form mounts submitting identical
 * readings for the same camp on the same day carry two distinct UUIDs —
 * the upsert sees two keys and writes two byte-identical "Camp condition"
 * rows. This guard closes that gap.
 *
 * Rejects when an existing row has the same camp, the same tenant calendar
 * day (bucketed via {@link getTenantDayRange} — consistent with the rest
 * of the codebase's day-bucketing, e.g. `countInspectedToday`), AND a
 * byte-identical `details` payload.
 *
 * The lookup EXCLUDES the new write's own `clientLocalId`: a genuine
 * offline-sync retry replays the same UUID, so without this exclusion the
 * retry would find its own first-attempt row and be wrongly rejected —
 * breaking the #206 idempotency contract. Excluding it means a retry finds
 * only its own row (filtered out) → falls through to the upsert, which
 * returns the existing id; a SECOND MOUNT carries a different UUID, so it
 * sees the first mount's row and is correctly rejected.
 *
 * A same-day re-inspection with *different* `details` is a legitimate
 * second reading: the `details` equality predicate lets it through.
 */
async function assertNotDuplicateCampCondition(
  client: ObservationWriter,
  input: {
    camp_id: string;
    details: string;
    observedAt: Date;
    clientLocalId: string | null | undefined;
  },
): Promise<void> {
  // Issue #378 — resolve the tenant's stored timezone so the day-bucket
  // agrees with every other day-bucketing call site in the codebase.
  // A drift-resilient try/catch is used instead of `settle()` (cached.ts-local)
  // so that a legacy tenant DB missing the `timezone` column never causes the
  // camp-condition write to fail — it falls back to SAST and continues.
  let tenantTz: string = "Africa/Johannesburg";
  try {
    const settingsRow = await client.farmSettings.findFirst();
    if (settingsRow?.timezone) {
      tenantTz = settingsRow.timezone;
    }
  } catch {
    // Schema drift: `no such column: timezone` on legacy tenant DBs.
    // Fall back to Africa/Johannesburg — harmless for SA-only tenants.
  }
  const { dayStart, dayEnd } = getTenantDayRange(tenantTz, input.observedAt);
  const existing = await client.observation.findFirst({
    where: {
      type: "camp_condition",
      campId: input.camp_id,
      details: input.details,
      observedAt: { gte: dayStart, lt: dayEnd },
      // Retry-safety: never match the new write's own first-attempt row
      // (a `clientLocalId` retry replays the same UUID). A bare `create`
      // with no UUID still matches every other row, which is correct.
      ...(input.clientLocalId
        ? { clientLocalId: { not: input.clientLocalId } }
        : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw new DuplicateObservationError(existing.id);
  }
}

export interface CreateObservationInput {
  type: string;
  camp_id: string;
  animal_id?: string | null;
  /**
   * ADR-0006 — drives the species-stamping waterfall when no
   * `animal_id` is in scope (e.g. mob-movement observations). NOT
   * persisted on the row (the `Observation` schema has no `mobId`
   * column); mob provenance lives in the `details` JSON of mob-typed
   * observations. The door looks the mob up to read its species and
   * throws {@link MobNotFoundError} on FK miss.
   */
  mob_id?: string | null;
  details?: string | null;
  created_at?: string | null;
  /** Email of the actor — captured on the audit trail. */
  loggedBy: string | null;
  /**
   * ADR-0006 — when an `attachmentUrl` belongs on the row (e.g. an
   * admin photo upload), pass it through here. The pre-ADR-0006
   * photos route called `prisma.observation.create` directly to set
   * this field; lifting it into the door's input keeps the bypass
   * closed.
   */
  attachmentUrl?: string | null;
  /**
   * Issue #206 — client-generated UUID for idempotent retries. The Logger
   * forms generate this at mount via `crypto.randomUUID()`; the offline-sync
   * queue replays it verbatim on retry. When supplied, the domain op upserts
   * on this column so a retried submit returns the existing observation's
   * id (200, not 409, not duplicate row). Omitting it falls back to the
   * legacy create path — back-compat for callers that pre-date #206.
   */
  clientLocalId?: string | null;
  /**
   * Issue #492 (PRD #479 backlog) — optional first-class free-text note (Path
   * A). Cross-cutting unstructured text the farmer types on ANY observation
   * type (independent of the structured `details` payload). Sanitised by
   * {@link sanitizeNote} (trim + {@link NOTE_MAX_LENGTH} cap); blank/absent →
   * `null`. Written ONLY on the CREATE side of the #206 idempotency upsert —
   * a replayed retry must NOT mutate the first-written note (audit-trail /
   * first-write-wins invariant), so it is deliberately absent from the
   * upsert's `update: {}` clause.
   */
  notes?: string | null;
}

export interface CreateObservationResult {
  success: true;
  id: string;
}

export async function createObservation(
  client: ObservationWriter,
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

  // Issue #366 — byte-identical duplicate guard for camp_condition. Runs
  // BEFORE the upsert/create paths so a second form mount with identical
  // readings is rejected before any row is written. The lookup excludes
  // the write's own `clientLocalId`, so a genuine #206 retry still falls
  // through to the upsert and collapses unchanged.
  if (input.type === "camp_condition") {
    await assertNotDuplicateCampCondition(client, {
      camp_id: input.camp_id,
      details: input.details ?? "",
      observedAt,
      clientLocalId: input.clientLocalId,
    });
  }

  // Load the camp once with both its existence (for the NotFound guard)
  // and its species (for the waterfall's step-3 fallback when neither
  // animal_id nor mob_id is in scope).
  const campExists = await crossSpecies(
    client,
    "species-registry-internal",
  ).camp.findFirst({
    where: { campId: input.camp_id },
    select: { campId: true, species: true },
  });
  if (!campExists) {
    throw new CampNotFoundError(input.camp_id);
  }

  // ADR-0006 species-stamping waterfall (most-specific source wins).
  // Pre-ADR-0006 the door used `animal?.species ?? null` — silently
  // wrote NULL on FK miss, hiding referential-integrity violations as
  // legitimate "orphan" rows that the read side's NULL-tolerant
  // predicate then silently included in every per-species query. The
  // throws on miss close that hole at the call site.
  let species: string | null = null;
  if (input.animal_id) {
    const animal = await client.animal.findUnique({
      where: { animalId: input.animal_id },
      select: { species: true },
    });
    if (!animal) {
      throw new AnimalNotFoundError(input.animal_id);
    }
    species = animal.species;
  } else if (input.mob_id) {
    const mob = await client.mob.findUnique({
      where: { id: input.mob_id },
      select: { species: true },
    });
    if (!mob) {
      throw new MobNotFoundError(input.mob_id);
    }
    species = mob.species;
  } else if (campExists.species) {
    species = campExists.species;
  }

  // Issue #487 (PRD #479, Epic C) — species-aware weight gate. Runs AFTER the
  // species-stamping waterfall (so the cap is species-correct) and BEFORE the
  // upsert/create paths below, so a duplicate bad weight is rejected, never
  // stored. `getMaxLiveWeightKg` is throw-free for a null/unknown species (it
  // falls back to the absolute ceiling), so the gate degrades to "reject only
  // the physically-impossible" rather than failing the write. Other types
  // carry unrelated `details` shapes and are deliberately untouched.
  if (input.type === "weighing") {
    validateWeighingObservation(input.details, getMaxLiveWeightKg(species));
  }

  // Issue #492 — sanitise the optional free-text note BEFORE either write
  // path. Trim + cap; an over-length note throws NoteTooLongError here so a
  // duplicate bad note is rejected, never stored. Blank/absent → null.
  const notes = sanitizeNote(input.notes);

  // Issue #206 — idempotent write path. When the client supplies a UUID, route
  // through `upsert` so a retry returns the original row instead of creating a
  // duplicate. The `update: {}` is intentional: the observation contents at
  // first-write time are canonical; a retry with a tweaked `details` must NOT
  // silently mutate the persisted row (audit trail integrity). The race between
  // SELECT-then-INSERT lives in `create` — `upsert` against the UNIQUE index
  // (`idx_observation_client_local_id`, migration 0019) collapses concurrent
  // retries down to a single row at the DB layer.
  if (input.clientLocalId) {
    const record = await client.observation.upsert({
      where: { clientLocalId: input.clientLocalId },
      // Issue #492 — `notes` is deliberately NOT in `update: {}`. A replayed
      // retry hits the existing row; first-written notes win and an in-flight
      // edit to `details` on a retry must not silently mutate the audit trail.
      update: {},
      create: {
        type: input.type,
        campId: input.camp_id,
        animalId: input.animal_id ?? null,
        details: input.details ?? "",
        observedAt,
        loggedBy: input.loggedBy,
        species,
        attachmentUrl: input.attachmentUrl ?? null,
        clientLocalId: input.clientLocalId,
        notes,
      },
    });
    return { success: true, id: record.id };
  }

  // Legacy fallback (no idempotency promise). Callers that pre-date #206 —
  // including the back-compat path for any server-side create that has no
  // client UUID in scope — keep the original behaviour.
  const record = await client.observation.create({
    data: {
      type: input.type,
      campId: input.camp_id,
      animalId: input.animal_id ?? null,
      details: input.details ?? "",
      observedAt,
      loggedBy: input.loggedBy,
      species,
      attachmentUrl: input.attachmentUrl ?? null,
      notes,
    },
  });

  return { success: true, id: record.id };
}
