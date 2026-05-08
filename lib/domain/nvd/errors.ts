/**
 * Wave G1 (#165) — domain-layer typed errors for `lib/domain/nvd/*`.
 *
 * Each error wraps a SCREAMING_SNAKE wire code that `mapApiDomainError`
 * (in `lib/server/api-errors.ts`) maps onto an HTTP envelope. The wire
 * shape stays bare `{ error: CODE }` (or `{ error: CODE, details: { field } }`
 * for the field-bearing variants), matching the typed-error envelope
 * pattern established in Waves D-F.
 *
 * Wave G1 wire-shape migrations vs. pre-G1 NVD routes:
 *   - 404 "NVD not found"           → `{ error: "NVD_NOT_FOUND" }`
 *   - 409 "NVD is already voided"   → `{ error: "NVD_ALREADY_VOIDED" }`
 *   - 400 "saleDate is required..."  → `{ error: "MISSING_REQUIRED_FIELD",
 *                                          details: { field: "saleDate" } }`
 *   - 400 "transport.driverName ..." → `{ error: "INVALID_TRANSPORT",
 *                                          details: { field: "driverName" } }`
 *   - 400 "Cannot issue NVD: in-withdrawal …" stays a domain failure but is
 *     surfaced as `INVALID_ANIMAL_IDS` to give the UI a stable code rather
 *     than the legacy free-form message.
 */

export const NVD_NOT_FOUND = "NVD_NOT_FOUND" as const;
export const NVD_ALREADY_VOIDED = "NVD_ALREADY_VOIDED" as const;
export const INVALID_TRANSPORT = "INVALID_TRANSPORT" as const;
export const MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD" as const;
export const INVALID_ANIMAL_IDS = "INVALID_ANIMAL_IDS" as const;

/** Field name carried by `INVALID_TRANSPORT.details.field`. */
export type InvalidTransportField =
  | "driverName"
  | "vehicleRegNumber"
  | "vehicleMakeModel"
  | "transport";

/**
 * Field name carried by `MISSING_REQUIRED_FIELD.details.field`. The four
 * fields here are all top-level NVD issue payload requirements; bad
 * transport sub-fields go through `InvalidTransportError` instead.
 */
export type MissingRequiredField =
  | "saleDate"
  | "buyerName"
  | "animalIds"
  | "declarationsJson";

/**
 * No NVD with the given id exists in the tenant. Wire: 404
 * `{ error: "NVD_NOT_FOUND" }`.
 */
export class NvdNotFoundError extends Error {
  readonly code = NVD_NOT_FOUND;
  readonly nvdId: string;
  constructor(nvdId: string) {
    super(`NVD not found: ${nvdId}`);
    this.name = "NvdNotFoundError";
    this.nvdId = nvdId;
  }
}

/**
 * Caller tried to void an NVD that is already voided. Wire: 409
 * `{ error: "NVD_ALREADY_VOIDED" }`.
 */
export class NvdAlreadyVoidedError extends Error {
  readonly code = NVD_ALREADY_VOIDED;
  readonly nvdId: string;
  constructor(nvdId: string) {
    super(`NVD is already voided: ${nvdId}`);
    this.name = "NvdAlreadyVoidedError";
    this.nvdId = nvdId;
  }
}

/**
 * `transport` payload was malformed (driver / vehicle reg / vehicle
 * make-model). Wire: 400 `{ error: "INVALID_TRANSPORT", details: { field } }`.
 *
 * Carries the offending sub-field so the UI can highlight the right
 * input on the NvdIssueForm. Mirrors `InvalidDateFormatError` from
 * Wave D — `mapApiDomainError` projects `details.field` onto the wire.
 */
export class InvalidTransportError extends Error {
  readonly code = INVALID_TRANSPORT;
  readonly field: InvalidTransportField;
  constructor(field: InvalidTransportField, message?: string) {
    super(message ?? `Invalid transport.${field}`);
    this.name = "InvalidTransportError";
    this.field = field;
  }
}

/**
 * Required top-level NVD issue field is missing or empty. Wire: 400
 * `{ error: "MISSING_REQUIRED_FIELD", details: { field } }`.
 */
export class MissingRequiredFieldError extends Error {
  readonly code = MISSING_REQUIRED_FIELD;
  readonly field: MissingRequiredField;
  constructor(field: MissingRequiredField, message?: string) {
    super(message ?? `Missing required field: ${field}`);
    this.name = "MissingRequiredFieldError";
    this.field = field;
  }
}

/**
 * One or more animals are blocked from issue (e.g. inside withdrawal
 * window). Wire: 400 `{ error: "INVALID_ANIMAL_IDS" }`. The full blocker
 * list is logged server-side; the wire stays code-only to avoid leaking
 * arbitrary animal names to non-tenant callers (defence-in-depth — the
 * route is auth+slug gated regardless).
 */
export class InvalidAnimalIdsError extends Error {
  readonly code = INVALID_ANIMAL_IDS;
  readonly blockerIds: ReadonlyArray<string>;
  constructor(blockerIds: ReadonlyArray<string>, message?: string) {
    super(message ?? `Invalid animal ids: ${blockerIds.join(", ")}`);
    this.name = "InvalidAnimalIdsError";
    this.blockerIds = blockerIds;
  }
}
