/**
 * Issue #487 (PRD #479, Epic C Phase 1) — `WeighingObservationValidator`.
 *
 * Server-side defense-in-depth for weight observations. Mirrors the #253
 * reproductive-state and #254 death validators one-for-one — same hand-rolled
 * style (no `zod` runtime dep), a typed error class carrying a SCREAMING_SNAKE
 * `code`, and a `coerceDetails` helper that tolerates the JSON-string payload
 * the offline-sync queue `JSON.stringify`s before POST.
 *
 * The bug class:
 *   Neither the logger nor the admin create/edit boundary capped the weight a
 *   client could persist. A stale / fat-fingered / malicious client could POST
 *   a `weighing` observation with a negative weight, a zero, a non-numeric
 *   value, or a physically-impossible 999,999 kg. The downstream ADG /
 *   cost-of-gain / weight-history analytics then divided by or charted that
 *   garbage, producing nonsense KPIs that looked authoritative.
 *
 * The fix is layered:
 *   1. UI: species-appropriate `min`/`max` on every weight input
 *      (`WeighingForm`, `CreateObservationModal`, the observations-log edit
 *      form) — UX feedback only.
 *   2. Server: this validator, gated at BOTH observation write boundaries:
 *        - CREATE: `createObservation` calls it AFTER the species-stamping
 *          waterfall and BEFORE the idempotency upsert, so a duplicate bad
 *          weight is rejected, never stored.
 *        - EDIT: `updateObservation` reads the existing row's species, derives
 *          the cap, and validates the incoming weight before persisting.
 *      Both boundaries map `WeightOutOfRangeError` onto
 *      `422 { error: "WEIGHT_OUT_OF_RANGE" }` via `mapApiDomainError`.
 *
 * Field name:
 *   The canonical persisted field is `weight_kg` (the logger page emits
 *   `JSON.stringify({ weight_kg: ... })`; the analytics layer reads
 *   `details.weight_kg`). For resilience against the historical camelCase
 *   drift seen across the codebase (`weight_kg ?? weightKg` appears in
 *   `lib/server/export/weight-history.ts` and the timeline parsers), we
 *   resolve `weight_kg` first and fall back to `weightKg`.
 *
 * Scope discipline:
 *   The public entry point is `validateWeighingObservation(details, speciesMax)`.
 *   The CALLER is responsible for gating it on `type === 'weighing'` — symmetric
 *   with the externally-gated death validator. It is never invoked for any other
 *   observation type, so treatment / camp_condition / repro flow through
 *   unchanged.
 */

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
 * Coerce a `details` payload into a plain object. The logger queue
 * `JSON.stringify`s `details` before POST, but a server caller (the create
 * door, the edit door) can pass an object directly. Anything that fails to
 * parse is treated as empty, which makes the missing-weight check fire.
 *
 * Symmetric with `coerceDetails` in `death.ts` / `reproductive-state.ts`.
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

/**
 * Parse the weight field into a finite number, or `null` if absent / NaN.
 *
 * Canonical key is `weight_kg`; `weightKg` is accepted as a fallback for the
 * historical camelCase drift. A numeric or numeric-string value is accepted —
 * the offline queue sometimes stringifies the whole payload, and some legacy
 * importers stored the weight as a string.
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
 * Validate a weighing observation payload against a species-derived ceiling.
 * Throws `WeightOutOfRangeError` (→ 422 WEIGHT_OUT_OF_RANGE) when the weight is:
 *
 *   - missing / non-numeric (a weighing with no weight is not a weighing),
 *   - ≤ 0 (negative or zero — physically impossible for a live animal),
 *   - > `speciesMax` (above the species-appropriate live-weight ceiling).
 *
 * `speciesMax` is resolved by the caller from `lib/species/breeding-constants`
 * (`getMaxLiveWeightKg`), so an unknown / null species still gets a sane
 * absolute ceiling rather than no cap at all.
 */
export function validateWeighingObservation(
  details: unknown,
  speciesMax: number,
): void {
  const parsed = coerceDetails(details);
  const weight = parseWeight(parsed);

  if (weight === null) {
    throw new WeightOutOfRangeError(
      "Weighing observation requires a numeric weight_kg.",
    );
  }
  if (weight <= 0) {
    throw new WeightOutOfRangeError(
      `Weight must be greater than 0 kg (got ${weight}).`,
    );
  }
  if (weight > speciesMax) {
    throw new WeightOutOfRangeError(
      `Weight ${weight} kg exceeds the maximum of ${speciesMax} kg for this species.`,
    );
  }
}
