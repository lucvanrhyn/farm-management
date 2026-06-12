/**
 * ADR-0007 (#513) — per-observation-type `details` Zod schema registry.
 *
 * THE single home for every typed observation's structured `details` contract.
 * Before this module, four hand-rolled validators (`lib/server/validators/{weighing,
 * death,reproductive-state}.ts` + an inline camp_condition guard) each
 * reimplemented the same `coerceDetails` helper and were wired in three
 * different places — two inside the write door, two in the route handler (which
 * left the `move-mob` / `update-task` door callers unprotected). This registry
 * is the convergence ADR-0007 specifies: declare the contract once per type,
 * validate uniformly in the door, before the idempotency upsert.
 *
 * Design (ADR-0007 "Registry shape" + "Migration path"):
 *
 *   - A partial record keyed by the canonical `ObservationType` strings. A type
 *     ABSENT from the map has no structured contract yet — its details pass
 *     through unvalidated (pass-through default; mirrors today's behaviour for
 *     the ~14 free-form types). The type allowlist (`InvalidTypeError` in the
 *     door) is the separate, already-structural guard against arbitrary strings.
 *
 *   - `.passthrough()` (NOT `.strict()`): a registered schema asserts the
 *     REQUIRED fields are present and well-typed; it must never reject extra
 *     provenance keys (`logged_by`, client metadata, …). `.strict()` would turn
 *     every such key into a regression.
 *
 *   - `z.coerce.number()` for the JSON-string ambiguity: the offline-sync queue
 *     `JSON.stringify`s the whole payload, so a numeric field can arrive as
 *     `"412"`. Coercion reproduces the hand-rolled `parseWeight` exactly.
 *
 *   - `weighing`'s ceiling is species-dependent, so its entry is a
 *     `(speciesMax) => ZodSchema` FACTORY rather than a static schema.
 *
 * Wire-code preservation (ADR-0007 criterion 3, two-phase migration):
 *   During this migration each per-type code is preserved BYTE-IDENTICALLY. A
 *   failed parse re-throws the SAME legacy typed error the standalone validators
 *   threw — `WeightOutOfRangeError`, `Death{MultiCause,DisposalRequired}Error`,
 *   `Repro{MultiState,Required,FieldRequired}Error`, `CampConditionFieldRequiredError`
 *   — so `mapApiDomainError` and every existing test/offline-sync classifier are
 *   untouched. `DetailsValidationError` (the canonical `DETAILS_VALIDATION_FAILED`
 *   envelope) is introduced here for FUTURE typed schemas; switching the legacy
 *   codes to it is a separate, signed-off follow-up (ADR-0007 "After migration").
 */
import { z } from "zod";

import type { ObservationType } from "./registry";

// ────────────────────────────────────────────────────────────────────────────
// Typed errors — the live wire contract. Relocated here (ADR-0007 §Cleanup) so
// the registry owns the per-type validation surface end to end. `WeightOutOfRangeError`
// retains its identity so `lib/server/api-errors.ts` (which maps it to 422) and
// every existing test keep working through the legacy `lib/server/validators/weighing.ts`
// re-export shim.
// ────────────────────────────────────────────────────────────────────────────

/** Typed error → mapped to `422 { error: "WEIGHT_OUT_OF_RANGE" }` by `mapApiDomainError`. */
export class WeightOutOfRangeError extends Error {
  readonly code = "WEIGHT_OUT_OF_RANGE" as const;
  constructor(message?: string) {
    super(
      message ??
        "Weighing observation requires a positive weight within the species range.",
    );
    this.name = "WeightOutOfRangeError";
  }
}

/**
 * Maintainer-locked enum (HITL #254). Regulatory-safe initial set per
 * SARS / NSPCA conventions. Mirrored verbatim in:
 *   - the migration file (`migrations/0021_death_carcass_disposal.sql`)
 *   - the UI <Select /> options (`components/logger/DeathModal.tsx`)
 *   - this registry's `VALID_DISPOSALS` set
 */
export const CARCASS_DISPOSAL_VALUES = [
  "BURIED",
  "BURNED",
  "RENDERED",
  "OTHER",
] as const;

export type CarcassDisposal = (typeof CARCASS_DISPOSAL_VALUES)[number];

const VALID_DISPOSALS: ReadonlySet<string> = new Set(CARCASS_DISPOSAL_VALUES);

/** Typed error → mapped to `422 { error: "DEATH_MULTI_CAUSE" }` by the door. */
export class DeathMultiCauseError extends Error {
  readonly code = "DEATH_MULTI_CAUSE" as const;
  constructor(message?: string) {
    super(message ?? "Death observation cannot assert more than one cause.");
    this.name = "DeathMultiCauseError";
  }
}

/** Typed error → mapped to `422 { error: "DEATH_DISPOSAL_REQUIRED" }` by the door. */
export class DeathDisposalRequiredError extends Error {
  readonly code = "DEATH_DISPOSAL_REQUIRED" as const;
  constructor(message?: string) {
    super(
      message ??
        `Death observation requires carcassDisposal to be one of: ${CARCASS_DISPOSAL_VALUES.join(
          ", ",
        )}.`,
    );
    this.name = "DeathDisposalRequiredError";
  }
}

/** Typed error → mapped to `422 { error: "REPRO_MULTI_STATE" }` by the door. */
export class ReproMultiStateError extends Error {
  readonly code = "REPRO_MULTI_STATE" as const;
  constructor(message?: string) {
    super(
      message ?? "Reproductive observation cannot assert more than one state.",
    );
    this.name = "ReproMultiStateError";
  }
}

/** Typed error → mapped to `422 { error: "REPRO_REQUIRED" }` by the door. */
export class ReproRequiredError extends Error {
  readonly code = "REPRO_REQUIRED" as const;
  constructor(message?: string) {
    super(message ?? "Reproductive observation must assert exactly one state.");
    this.name = "ReproRequiredError";
  }
}

/**
 * Typed error → mapped to `422 { error: "REPRO_FIELD_REQUIRED" }` by the door.
 * Raised when a sub-flow (insemination, BCS, temperament, calving) is missing
 * its required, actively-chosen field.
 */
export class ReproFieldRequiredError extends Error {
  readonly code = "REPRO_FIELD_REQUIRED" as const;
  constructor(message?: string) {
    super(
      message ??
        "Reproductive observation is missing a required field that must be actively selected.",
    );
    this.name = "ReproFieldRequiredError";
  }
}

/** Wire code for {@link CampConditionFieldRequiredError}. */
export const CAMP_CONDITION_FIELD_REQUIRED =
  "CAMP_CONDITION_FIELD_REQUIRED" as const;

/**
 * Issue #321 (PRD #318 stress-test remediation, wave R4).
 *
 * A `camp_condition` observation reached the write boundary without an explicit
 * grazing / water / fence reading. `field` names the first missing/blank
 * selection so the caller can surface a precise message rather than a generic
 * 500. Carries its own SCREAMING_SNAKE `code` so the API error mapper /
 * offline-sync queue can react to it like every other typed observation error.
 *
 * Relocated here from `create-observation.ts` (ADR-0007 §Cleanup) so the
 * camp_condition completeness contract lives with the rest of the per-type
 * `details` schemas. Re-exported from `create-observation.ts` for back-compat
 * with existing importers (`api-errors.ts`, the domain test).
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
 * ADR-0007 — the canonical typed error for NEW per-type schemas. Carries the
 * Zod issue list so the envelope can forward field-level info (the envelope +
 * `tenantWrite` adapter were designed around this shape). NOT yet used by the
 * four migrated families — they preserve their legacy codes during this wave;
 * adopting `DETAILS_VALIDATION_FAILED` for them is a separate, signed-off
 * follow-up.
 */
export const DETAILS_VALIDATION_FAILED = "DETAILS_VALIDATION_FAILED" as const;

export class DetailsValidationError extends Error {
  readonly code = DETAILS_VALIDATION_FAILED;
  readonly issues: z.core.$ZodIssue[];
  constructor(issues: z.core.$ZodIssue[]) {
    super("Observation details failed validation.");
    this.name = "DetailsValidationError";
    this.issues = issues;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Shared `details` coercion — the ONE canonical copy (ADR-0007 §Registry shape).
// The three standalone validators each duplicated this verbatim; it is lifted
// here so the JSON-string-or-object ambiguity is resolved in exactly one place.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Coerce a `details` payload into a plain object. The logger queue
 * `JSON.stringify`s `details` before POST, but a server caller (the create
 * door, the edit door) can pass an object directly. Anything that fails to
 * parse is treated as empty (`null`), which makes the per-family "missing
 * required field" check fire.
 */
function coerceDetails(details: unknown): Record<string, unknown> | null {
  if (details === null || details === undefined) return null;
  if (typeof details === "object") return details as Record<string, unknown>;
  if (typeof details === "string") {
    if (details.length === 0) return null;
    try {
      const parsed = JSON.parse(details);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// weighing — species-aware cap. Factory: (speciesMax) => schema.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse the weight field into a finite number, or `null` if absent / NaN.
 * Canonical key is `weight_kg`; `weightKg` is accepted as a fallback for the
 * historical camelCase drift. A numeric or numeric-string value is accepted.
 */
function parseWeight(details: Record<string, unknown> | null): number | null {
  if (!details) return null;
  const raw = details.weight_kg ?? details.weightKg;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The weighing details schema for a given species ceiling. Implemented as a
 * thin `.superRefine` over the parsed payload so the exact legacy edge-cases
 * (camelCase fallback, numeric-string coercion, ≤0 rejection, missing-weight
 * rejection) are preserved one-for-one — and the failure re-throws
 * `WeightOutOfRangeError` so the `WEIGHT_OUT_OF_RANGE` wire code is byte-identical.
 *
 * `speciesMax` is resolved by the caller from `lib/species/breeding-constants`
 * (`getMaxLiveWeightKg`), so an unknown / null species still gets a sane
 * absolute ceiling rather than no cap at all.
 */
export function weighingDetailsSchema(
  speciesMax: number,
): z.ZodType<Record<string, unknown>> {
  return z
    .record(z.string(), z.unknown())
    .superRefine((value, ctx) => {
      const weight = parseWeight(value);
      if (weight === null) {
        ctx.addIssue({
          code: "custom",
          message: "Weighing observation requires a numeric weight_kg.",
        });
        return;
      }
      if (weight <= 0) {
        ctx.addIssue({
          code: "custom",
          message: `Weight must be greater than 0 kg (got ${weight}).`,
        });
        return;
      }
      if (weight > speciesMax) {
        ctx.addIssue({
          code: "custom",
          message: `Weight ${weight} kg exceeds the maximum of ${speciesMax} kg for this species.`,
        });
      }
    }) as unknown as z.ZodType<Record<string, unknown>>;
}

/**
 * Validate a weighing observation payload against a species-derived ceiling.
 * Throws `WeightOutOfRangeError` (→ 422 WEIGHT_OUT_OF_RANGE). Retained as the
 * door + edit-door entry point and the unit-test surface; backed by
 * {@link weighingDetailsSchema}.
 */
export function validateWeighingObservation(
  details: unknown,
  speciesMax: number,
): void {
  const parsed = coerceDetails(details) ?? {};
  const result = weighingDetailsSchema(speciesMax).safeParse(parsed);
  if (!result.success) {
    throw new WeightOutOfRangeError(result.error.issues[0]?.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// camp_condition — grazing / water / fence completeness.
// ────────────────────────────────────────────────────────────────────────────

/**
 * The required camp_condition selection keys, in the order the farmer answers
 * them. The persisted `details` is `JSON.stringify({ grazing, water, fence,
 * logged_by })`, so these are the keys to assert on.
 */
const CAMP_CONDITION_REQUIRED_FIELDS = ["grazing", "water", "fence"] as const;

/**
 * The camp_condition completeness schema. A `.superRefine` that throws (via the
 * door) `CampConditionFieldRequiredError` naming the FIRST missing/blank field
 * — so the `CAMP_CONDITION_FIELD_REQUIRED` + `{ field }` envelope is preserved.
 *
 * NB: the byte-identical-duplicate guard `assertNotDuplicateCampCondition`
 * (in the door) is NOT a details-shape check — it stays a separate door step;
 * the registry only subsumes the completeness assertion.
 */
function campConditionDetailsSchema(): z.ZodType<Record<string, unknown>> {
  return z
    .record(z.string(), z.unknown())
    .superRefine((value, ctx) => {
      for (const field of CAMP_CONDITION_REQUIRED_FIELDS) {
        const v = value[field];
        if (typeof v !== "string" || v.trim() === "") {
          ctx.addIssue({
            code: "custom",
            message: field,
            path: [field],
          });
          return;
        }
      }
    }) as unknown as z.ZodType<Record<string, unknown>>;
}

/**
 * Throws {@link CampConditionFieldRequiredError} unless `details` parses to an
 * object carrying a non-blank value for every required field. Defends against:
 * empty/absent details, malformed JSON, an omitted key, and an explicit
 * `null`/empty-string sentinel.
 */
export function validateCampConditionComplete(details: unknown): void {
  const parsed = coerceDetails(details) ?? {};
  const result = campConditionDetailsSchema().safeParse(parsed);
  if (!result.success) {
    const field = result.error.issues[0]?.message as
      | "grazing"
      | "water"
      | "fence"
      | undefined;
    throw new CampConditionFieldRequiredError(field ?? "grazing");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// death — single-cause + valid carcassDisposal enum.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Count distinct cause assertions on a death-observation payload. A payload
 * that asserts more than one cause is rejected (the multi-cause class). Returns
 * 0 when the payload makes no cause assertion (treated as a soft-empty path —
 * the disposal-required check fires for empty payloads).
 */
function countCauses(details: Record<string, unknown> | null): number {
  if (!details) return 0;
  let count = 0;
  if (typeof details.cause === "string" && details.cause.length > 0) {
    count += 1;
  } else if (Array.isArray(details.cause)) {
    count += details.cause.filter(
      (c) => typeof c === "string" && c.length > 0,
    ).length;
  }
  if (Array.isArray(details.causes)) {
    count += details.causes.filter(
      (c) => typeof c === "string" && c.length > 0,
    ).length;
  }
  return count;
}

/**
 * Validate a death observation payload. Throws a typed error that
 * `mapApiDomainError` maps onto a 422 envelope.
 *
 * Order matters: multi-cause is checked first (the more dangerous bug — silent
 * data loss of cause information); disposal-required second (an empty payload
 * reads as "no cause + no disposal" and the actionable fix is to pick both).
 */
export function validateDeathObservation(details: unknown): void {
  const parsed = coerceDetails(details);

  const causeCount = countCauses(parsed);
  if (causeCount > 1) {
    throw new DeathMultiCauseError(
      "Death observation cannot assert more than one cause. Pick exactly one (Disease, Predator, Accident, Old age, Stillbirth, or Other).",
    );
  }

  const disposal = parsed?.carcassDisposal;
  if (typeof disposal !== "string" || !VALID_DISPOSALS.has(disposal)) {
    throw new DeathDisposalRequiredError();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// reproductive family — heat / pregnancy multi-state + per-type required fields.
// ────────────────────────────────────────────────────────────────────────────

const REPRO_STATE_TYPES: ReadonlySet<string> = new Set([
  "heat_detection",
  "pregnancy_scan",
]);

const REPRO_REQUIRED_FIELD_TYPES: ReadonlySet<string> = new Set([
  "insemination",
  "body_condition_score",
  "temperament_score",
  "calving",
  // S24 / obs-M1 — the ReproductionForm's measured sub-flow that was missing
  // from this family: its payload feeds breeding scoring
  // (`lib/server/breeding/trait-profile.ts` reads `details.measurement_cm`)
  // but had NO server-side gate, so a stale / offline-queued client could
  // persist a missing, NaN, or absurd measurement.
  "scrotal_circumference",
]);

const REPRO_TYPES: ReadonlySet<string> = new Set([
  ...REPRO_STATE_TYPES,
  ...REPRO_REQUIRED_FIELD_TYPES,
]);

/** Recognised insemination service methods (mirrors ReproductionForm). */
const INSEM_METHODS: ReadonlySet<string> = new Set(["AI", "natural"]);

/** Inclusive score bounds per scored observation type. */
const SCORE_BOUNDS: Record<string, { min: number; max: number }> = {
  body_condition_score: { min: 1, max: 9 },
  temperament_score: { min: 1, max: 5 },
};

/**
 * S24 / obs-M1 — inclusive bounds (cm) for a `scrotal_circumference`
 * observation's `measurement_cm`. Mirrors the UI input contract the client
 * already advertises (`components/logger/ReproductionForm.tsx`,
 * `<input min="20" max="50">`) so the server enforces the same range the
 * form does — closing the client-side-only gap for the field that feeds
 * breeding scoring (`lib/server/breeding/{trait-profile,scoring}.ts`).
 */
export const SCROTAL_CIRCUMFERENCE_BOUNDS_CM = {
  min: 20,
  max: 50,
} as const;

/** Truthy in the colloquial sense — `true`, `"true"`, `1`, `"1"`. */
function isTruthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value === "true" || value === "1";
  if (typeof value === "number") return value === 1;
  return false;
}

/**
 * Count the number of mutually-exclusive reproductive states asserted by a
 * `details` payload, given the observation `type`. 0 → `REPRO_REQUIRED`, 1 →
 * happy path, ≥2 → `REPRO_MULTI_STATE`. Each state is counted at most once.
 */
function countStateAssertions(
  type: string,
  details: Record<string, unknown> | null,
): number {
  if (!details) return 0;

  let inHeat = false;
  let pregnant = false;
  let open = false;
  let uncertain = false;

  if (typeof details.method === "string" && details.method.length > 0) {
    inHeat = true;
  }
  if (isTruthyFlag(details.in_heat) || isTruthyFlag(details.inHeat)) {
    inHeat = true;
  }

  if (type === "pregnancy_scan" && typeof details.result === "string") {
    if (details.result === "pregnant") pregnant = true;
    else if (details.result === "empty") open = true;
    else if (details.result === "uncertain") uncertain = true;
  }

  if (isTruthyFlag(details.pregnant)) pregnant = true;
  if (isTruthyFlag(details.open)) open = true;

  return [inHeat, pregnant, open, uncertain].filter(Boolean).length;
}

/** Parse a `score`-like field into a finite number, or `null` if absent/NaN. */
function parseScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True when `value` is a non-empty, non-whitespace string. */
function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Required-field validation for the sub-flows. Each type has exactly one
 * actively-chosen answer that a pre-filled default must not be able to
 * fabricate. Throws `ReproFieldRequiredError` (422 REPRO_FIELD_REQUIRED).
 */
function validateRequiredField(
  type: string,
  details: Record<string, unknown> | null,
): void {
  if (type === "insemination") {
    const method = details?.method;
    if (typeof method !== "string" || !INSEM_METHODS.has(method)) {
      throw new ReproFieldRequiredError(
        "Insemination requires a service method of AI or natural.",
      );
    }
    return;
  }

  if (type === "calving") {
    if (!hasText(details?.calf_tag) && !hasText(details?.calfAnimalId)) {
      throw new ReproFieldRequiredError(
        "Calving observation requires a calf ear tag (calf identity).",
      );
    }
    return;
  }

  if (type === "scrotal_circumference") {
    // S24 / obs-M1 — the measurement is the observation's single actively
    // entered answer; it must be numeric (the queue stringifies, so a
    // numeric string is fine) and within the UI-advertised 20..50 cm range.
    // A missing / NaN / out-of-range value would otherwise flow straight
    // into the bull trait profile (`parseFloat(d.measurement_cm)`).
    const cm = parseScore(details?.measurement_cm);
    if (
      cm === null ||
      cm < SCROTAL_CIRCUMFERENCE_BOUNDS_CM.min ||
      cm > SCROTAL_CIRCUMFERENCE_BOUNDS_CM.max
    ) {
      throw new ReproFieldRequiredError(
        `scrotal_circumference requires a measurement_cm between ${SCROTAL_CIRCUMFERENCE_BOUNDS_CM.min} and ${SCROTAL_CIRCUMFERENCE_BOUNDS_CM.max} cm.`,
      );
    }
    return;
  }

  const bounds = SCORE_BOUNDS[type];
  if (bounds) {
    const score = parseScore(details?.score);
    if (score === null || score < bounds.min || score > bounds.max) {
      throw new ReproFieldRequiredError(
        `${type} requires a score between ${bounds.min} and ${bounds.max}.`,
      );
    }
    return;
  }
}

/**
 * Validate a reproductive observation payload. Throws a typed error that
 * `mapApiDomainError` maps onto a 422 envelope. A `type` outside `REPRO_TYPES`
 * is a no-op (the scope discipline that keeps the validator from
 * blast-radiusing into death / weighing / treatment).
 */
export function validateReproductiveState(type: string, details: unknown): void {
  if (!REPRO_TYPES.has(type)) return;

  const parsed = coerceDetails(details);

  if (REPRO_REQUIRED_FIELD_TYPES.has(type)) {
    validateRequiredField(type, parsed);
    return;
  }

  const count = countStateAssertions(type, parsed);

  if (count === 0) {
    throw new ReproRequiredError(
      type === "pregnancy_scan"
        ? "Pregnancy scan must include a result of pregnant, empty (Open), or uncertain."
        : "Reproductive observation must assert exactly one state (In Heat, Pregnant, or Open).",
    );
  }

  if (count > 1) {
    throw new ReproMultiStateError(
      "Reproductive observation cannot assert more than one of {In Heat, Pregnant, Open}.",
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Registry + unified door entry.
// ────────────────────────────────────────────────────────────────────────────

/** A schema that validates the PARSED details object for one observation type. */
export type DetailsSchema = z.ZodType<Record<string, unknown>>;

/**
 * A registry value is EITHER a static schema OR a `(speciesMax) => schema`
 * factory (for `weighing`, whose cap is species-dependent). The door resolves a
 * factory by passing the species-stamped ceiling.
 */
export type DetailsSchemaEntry =
  | DetailsSchema
  | ((speciesMax: number) => DetailsSchema);

/**
 * Registry of per-type details schemas. A type ABSENT from this map has no
 * structured contract yet — its details pass through unvalidated (pass-through
 * default). The nine first-adopter typed observations (ADR-0007 scope) plus
 * `scrotal_circumference` (S24 / obs-M1, the repro sub-flow ADR-0007 missed)
 * are registered; the remaining free-form types fall through to pass-through.
 *
 * The schemas here are the declarative shape; the door-facing
 * {@link validateObservationDetails} drives them and translates a parse failure
 * into the byte-identical legacy typed error for each family.
 */
export const DETAILS_SCHEMAS: Partial<
  Record<ObservationType, DetailsSchemaEntry>
> = {
  weighing: (speciesMax: number) => weighingDetailsSchema(speciesMax),
  camp_condition: campConditionDetailsSchema(),
  death: z.record(z.string(), z.unknown()),
  heat_detection: z.record(z.string(), z.unknown()),
  pregnancy_scan: z.record(z.string(), z.unknown()),
  insemination: z.record(z.string(), z.unknown()),
  body_condition_score: z.record(z.string(), z.unknown()),
  temperament_score: z.record(z.string(), z.unknown()),
  calving: z.record(z.string(), z.unknown()),
  scrotal_circumference: z.record(z.string(), z.unknown()),
};

/**
 * Look up the registry entry for a type. Returns `undefined` for an
 * unregistered (pass-through) type. The returned value may be a schema or a
 * `(speciesMax) => schema` factory — callers needing a resolved schema should
 * prefer {@link validateObservationDetails}.
 */
export function getDetailsSchema(type: string): DetailsSchemaEntry | undefined {
  return DETAILS_SCHEMAS[type as ObservationType];
}

/** Context the door threads into details validation (species-derived cap). */
export interface DetailsValidationContext {
  /** Species-appropriate live-weight ceiling (from `getMaxLiveWeightKg`). */
  speciesMax: number;
}

/**
 * THE single per-type details validation entry, consulted by `createObservation`
 * (before the idempotency upsert) and `updateObservation` (before persist).
 *
 * For a registered type it parses the `details` and, on failure, re-throws the
 * BYTE-IDENTICAL legacy typed error (so `mapApiDomainError`, the offline-sync
 * classifier, and every test see the same wire code as before). For an
 * unregistered type it is a no-op (pass-through). The type allowlist
 * (`InvalidTypeError`, in the door) is the separate guard against arbitrary
 * type strings, so "unregistered" here always means "a valid type with no
 * structured-details schema yet".
 *
 * Implemented as a dispatch over the four migrated families (each owning its
 * exact legacy error + message) rather than a generic `schema.parse` →
 * `DetailsValidationError`, because criterion 3 requires the per-type codes
 * preserved during this migration. The generic `DetailsValidationError` path is
 * reserved for future typed schemas.
 */
export function validateObservationDetails(
  type: string,
  details: unknown,
  ctx: DetailsValidationContext,
): void {
  switch (type) {
    case "weighing":
      validateWeighingObservation(details, ctx.speciesMax);
      return;
    case "camp_condition":
      validateCampConditionComplete(details);
      return;
    case "death":
      validateDeathObservation(details);
      return;
    case "heat_detection":
    case "pregnancy_scan":
    case "insemination":
    case "body_condition_score":
    case "temperament_score":
    case "calving":
    case "scrotal_circumference":
      validateReproductiveState(type, details);
      return;
    default:
      // Pass-through: an unregistered (free-form) type has no structured
      // contract yet. B2's wire-level string check still applies upstream.
      return;
  }
}
