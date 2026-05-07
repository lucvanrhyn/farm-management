/**
 * Wave C (#156) — domain-layer typed errors for `lib/domain/observations/*`.
 *
 * Each error wraps a SCREAMING_SNAKE wire code. The `mapApiDomainError`
 * helper at `lib/server/api-errors.ts` maps these onto canonical HTTP
 * responses so the wire shape stays backward-compatible with the
 * pre-Wave-C consumers (offline-sync queue, admin UI, audit walker).
 */

export const OBSERVATION_NOT_FOUND = "OBSERVATION_NOT_FOUND" as const;
export const CAMP_NOT_FOUND = "CAMP_NOT_FOUND" as const;
export const INVALID_TYPE = "INVALID_TYPE" as const;
export const INVALID_TIMESTAMP = "INVALID_TIMESTAMP" as const;

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
