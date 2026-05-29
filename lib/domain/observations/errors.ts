/**
 * Wave C (#156) — domain-layer typed errors for `lib/domain/observations/*`.
 *
 * Each error wraps a SCREAMING_SNAKE wire code. The `mapApiDomainError`
 * helper at `lib/server/api-errors.ts` maps these onto canonical HTTP
 * responses so the wire shape stays backward-compatible with the
 * pre-Wave-C consumers (offline-sync queue, admin UI, audit walker).
 *
 * ADR-0006 — `AnimalNotFoundError` / `MobNotFoundError` (added in this
 * wave) are *FK-violation* errors thrown by the species-stamping
 * waterfall inside `createObservation` when an `animal_id` / `mob_id`
 * input does not resolve. They are intentionally "fail loud" — a
 * referential-integrity violation has no graceful degradation path, and
 * the pre-ADR-0006 silent `species: null` coercion was the hole this
 * wave closes. The api-errors mapper does NOT special-case them; an
 * uncaught throw surfaces a 500 with the typed `code` in logs, which
 * is the correct behaviour for a "this should never happen" rail.
 */

export const OBSERVATION_NOT_FOUND = "OBSERVATION_NOT_FOUND" as const;
export const CAMP_NOT_FOUND = "CAMP_NOT_FOUND" as const;
export const ANIMAL_NOT_FOUND = "ANIMAL_NOT_FOUND" as const;
export const MOB_NOT_FOUND = "MOB_NOT_FOUND" as const;
export const INVALID_TYPE = "INVALID_TYPE" as const;
export const INVALID_TIMESTAMP = "INVALID_TIMESTAMP" as const;
export const DUPLICATE_OBSERVATION = "DUPLICATE_OBSERVATION" as const;
export const NOTE_TOO_LONG = "NOTE_TOO_LONG" as const;

/**
 * No observation with the given id exists in the tenant. Wire: 404
 * `{ error: "OBSERVATION_NOT_FOUND" }`.
 */
export class ObservationNotFoundError extends Error {
  readonly code = OBSERVATION_NOT_FOUND;
  readonly observationId: string;
  constructor(observationId: string) {
    super(`Observation not found: ${observationId}`);
    this.name = "ObservationNotFoundError";
    this.observationId = observationId;
  }
}

/**
 * The `camp_id` referenced by an observation create does not exist for
 * any species in this tenant. Wire: 404 `{ error: "CAMP_NOT_FOUND" }`.
 */
export class CampNotFoundError extends Error {
  readonly code = CAMP_NOT_FOUND;
  readonly campId: string;
  constructor(campId: string) {
    super(`Camp not found: ${campId}`);
    this.name = "CampNotFoundError";
    this.campId = campId;
  }
}

/**
 * ADR-0006 — the `animal_id` supplied to `createObservation` resolves to
 * no row. The Observation FK on `animalId` means this can only happen on
 * a referential-integrity violation (deleted animal, FK loosened in the
 * schema, race with a concurrent delete). Pre-ADR-0006 the door
 * silently coerced the missing-animal case to `species: null`, hiding
 * the violation as a normal "orphan" observation that the read side's
 * NULL-tolerant predicate then silently included in every per-species
 * query. The throw closes that hole.
 *
 * Distinct from the same-named class in `lib/domain/animals/errors`
 * (which guards the animal CRUD routes' `findUnique` miss): this one
 * is thrown from the observation-write door, lives in the observations
 * domain, and carries the SCREAMING_SNAKE wire `code`. Tests
 * discriminate by importing from this module.
 */
export class AnimalNotFoundError extends Error {
  readonly code = ANIMAL_NOT_FOUND;
  readonly animalId: string;
  constructor(animalId: string) {
    super(`Animal not found: ${animalId}`);
    this.name = "AnimalNotFoundError";
    this.animalId = animalId;
  }
}

/**
 * ADR-0006 — the `mob_id` supplied to `createObservation` resolves to no
 * row. Symmetric with {@link AnimalNotFoundError}: a missing mob is an
 * FK violation, not a legitimate "no species" case.
 *
 * Note: `lib/domain/mobs/move-mob.ts` defines its own `MobNotFoundError`
 * for the outer mob-move op (the mob being moved doesn't exist). The
 * two are conceptually adjacent but live in different domains: the
 * mob-move version is the caller's mob-not-found; this one is the
 * observation door's mob-lookup-during-species-stamping.
 */
export class MobNotFoundError extends Error {
  readonly code = MOB_NOT_FOUND;
  readonly mobId: string;
  constructor(mobId: string) {
    super(`Mob not found: ${mobId}`);
    this.name = "MobNotFoundError";
    this.mobId = mobId;
  }
}

/**
 * The observation `type` field is not in the allowlist of recognised
 * observation kinds. Treated as a business-rule violation rather than a
 * shape error so the offline-sync queue can react with a typed code
 * (legacy `400 "Invalid observation type"` is retired). Wire: 422
 * `{ error: "INVALID_TYPE" }`.
 */
export class InvalidTypeError extends Error {
  readonly code = INVALID_TYPE;
  readonly received: string;
  constructor(received: string) {
    super(`Invalid observation type: ${received}`);
    this.name = "InvalidTypeError";
    this.received = received;
  }
}

/**
 * The `created_at` field on an observation create is not a parseable
 * date string. Wire: 400 `{ error: "INVALID_TIMESTAMP" }`.
 */
export class InvalidTimestampError extends Error {
  readonly code = INVALID_TIMESTAMP;
  readonly received: string;
  constructor(received: string) {
    super(`Invalid created_at timestamp: ${received}`);
    this.name = "InvalidTimestampError";
    this.received = received;
  }
}

/**
 * Issue #366 — a `camp_condition` write is a byte-identical duplicate of
 * an observation already on the row for the same camp on the same tenant
 * calendar day.
 *
 * The `clientLocalId` upsert (#206) only collapses retries of ONE
 * submission — it mints a fresh UUID per form mount, so two separate
 * camp-condition form mounts submitting identical readings carry two
 * distinct keys and produce two byte-identical "Camp condition" rows.
 * This error is thrown by `createObservation` after a same camp + same
 * day + identical `details` row is found (excluding the new write's own
 * `clientLocalId`, so a genuine retry is never self-rejected). A same-day
 * re-inspection with *different* `details` is a legitimate second reading
 * and is NOT rejected.
 *
 * Wire: 422 `{ error: "DUPLICATE_OBSERVATION", details: { existingId } }`.
 * 422 (not 409) because the offline-sync `isTerminalStatus` classifier
 * treats a definitively-rejected payload as a terminal poison message —
 * and a duplicate's identical payload re-rejects identically forever, so
 * a blind retry is futile and the failed row must be discardable. The
 * logger UI keys off the typed code to show a clear "already logged"
 * message instead of the generic poison-row notice.
 */
export class DuplicateObservationError extends Error {
  readonly code = DUPLICATE_OBSERVATION;
  /** The id of the observation already on the row. */
  readonly existingId: string;
  constructor(existingId: string) {
    super(
      `Duplicate observation: an identical camp_condition was already logged today (${existingId})`,
    );
    this.name = "DuplicateObservationError";
    this.existingId = existingId;
  }
}

/**
 * Issue #492 (PRD #479 backlog) — the free-text `notes` field on an
 * observation create / edit exceeds {@link NOTE_MAX_LENGTH} characters
 * (measured AFTER trim). Notes are an unbounded free-text field; without a
 * cap a stale / malicious client could persist an arbitrarily large blob into
 * the `notes` column. Rejection (rather than silent truncation) is the
 * least-surprising rule: a truncated note silently loses the farmer's words,
 * whereas a rejection surfaces a fixable error.
 *
 * Wire: 400 `{ error: "NOTE_TOO_LONG", details: { maxLength } }` (mapped by
 * `mapApiDomainError`). 400 (not 422) mirrors the schema-shape rejection
 * family (`VALIDATION_FAILED`, `INVALID_TIMESTAMP`) — it is a malformed-input
 * error, not a domain business-rule conflict. Thrown from BOTH the create
 * door and the edit door so the cap holds at every write boundary; forwards
 * the typed `code` only (never the raw note) so no user text leaks into logs
 * (audit-error-envelope clean).
 */
export class NoteTooLongError extends Error {
  readonly code = NOTE_TOO_LONG;
  readonly maxLength: number;
  readonly received: number;
  constructor(maxLength: number, received: number) {
    super(`Note too long: ${received} chars (max ${maxLength})`);
    this.name = "NoteTooLongError";
    this.maxLength = maxLength;
    this.received = received;
  }
}
