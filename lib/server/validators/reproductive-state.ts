/**
 * Wave 1 / #253 — `ReproductiveStateValidator`.
 *
 * Server-side defense-in-depth for the Repro logger form. The 2026-05-13
 * stress test confirmed the UI was letting users mark a single cow as
 * In Heat + Pregnant + Open simultaneously, with the dirty payload silently
 * collapsed at the persistence layer (only In Heat was kept; the rest were
 * dropped). Worst of both worlds — bad UX AND data loss.
 *
 * The fix is layered:
 *   1. UI: a single radio (one of {In Heat, Pregnant, Open}) — owned by
 *      `components/logger/ReproductionForm.tsx`.
 *   2. Server: this validator. Even a stale or malicious client cannot
 *      bypass the rule, because `app/api/observations/route.ts` invokes
 *      `validateReproductiveState` on every reproductive POST and rejects
 *      multi-state / empty payloads with `422 { error: REPRO_MULTI_STATE }`
 *      or `422 { error: REPRO_REQUIRED }` before the row hits Prisma.
 *
 * Scope discipline (refs the wave HARD STOP from the dispatch brief):
 *   The shared `app/api/observations/route.ts` POST is the only handler
 *   wired across every observation type — including Death (Wave 2). To keep
 *   the two waves from colliding, this validator is a *no-op* for any
 *   `type` that is not `heat_detection` or `pregnancy_scan`. Death,
 *   weighing, treatment etc. flow through unchanged.
 *
 * Why a hand-rolled validator instead of `zod`:
 *   The repo doesn't carry a `zod` runtime dep yet — every existing route
 *   schema (`createObservationSchema` in the route file, `MobCreateSchema`
 *   etc.) is a duck-typed `parse()` object that throws on failure. We
 *   match that pattern so the surface stays consistent and we don't pull
 *   in a new dep just for one validator. The exported `validate*` function
 *   throws typed errors that the route handler maps to the wire envelope.
 */

/**
 * Reproductive observation types this validator gates on.
 *
 * Wave 285/286 (PRD #279) extends the set beyond the original
 * {heat_detection, pregnancy_scan} multi-state pair. The newly-covered
 * types each carry a *required field* (not a multi-state) contract:
 *
 *   - body_condition_score → numeric `score` in [1..9]
 *   - temperament_score    → numeric `score` in [1..5]
 *   - insemination         → `method` ∈ {AI, natural}
 *   - calving              → calf identity (`calf_tag` | `calfAnimalId`)
 *
 * Root cause closed: `ReproductionForm.tsx` pre-filled `useState` defaults
 * that read as the farmer's answer, and `CalvingForm.tsx` enforced the
 * required calf tag only via an `alert()`. A stale / offline-queued client
 * could persist a fabricated default; this validator is the server-side
 * backstop, mapped to `422 { error: REPRO_FIELD_REQUIRED }`.
 *
 * Any other `type` (death, weighing, treatment, …) is a no-op — see the
 * module docstring for the scope-discipline rationale.
 */
const REPRO_STATE_TYPES: ReadonlySet<string> = new Set([
  'heat_detection',
  'pregnancy_scan',
]);

/**
 * Per-type required-field specs for the Wave 285/286 sub-flows. Keyed by
 * observation `type`; each entry describes what counts as a present,
 * actively-chosen answer. Mirrors the death-observation validator's
 * single-source-of-truth enum-lock discipline.
 */
const REPRO_REQUIRED_FIELD_TYPES: ReadonlySet<string> = new Set([
  'insemination',
  'body_condition_score',
  'temperament_score',
  'calving',
]);

const REPRO_TYPES: ReadonlySet<string> = new Set([
  ...REPRO_STATE_TYPES,
  ...REPRO_REQUIRED_FIELD_TYPES,
]);

/** Recognised insemination service methods (mirrors ReproductionForm). */
const INSEM_METHODS: ReadonlySet<string> = new Set(['AI', 'natural']);

/** Inclusive score bounds per scored observation type. */
const SCORE_BOUNDS: Record<string, { min: number; max: number }> = {
  body_condition_score: { min: 1, max: 9 },
  temperament_score: { min: 1, max: 5 },
};

/** Typed error → mapped to `422 { error: "REPRO_MULTI_STATE" }` by the route. */
export class ReproMultiStateError extends Error {
  readonly code = 'REPRO_MULTI_STATE' as const;
  constructor(message?: string) {
    super(message ?? 'Reproductive observation cannot assert more than one state.');
    this.name = 'ReproMultiStateError';
  }
}

/** Typed error → mapped to `422 { error: "REPRO_REQUIRED" }` by the route. */
export class ReproRequiredError extends Error {
  readonly code = 'REPRO_REQUIRED' as const;
  constructor(message?: string) {
    super(message ?? 'Reproductive observation must assert exactly one state.');
    this.name = 'ReproRequiredError';
  }
}

/**
 * Typed error → mapped to `422 { error: "REPRO_FIELD_REQUIRED" }` by the
 * route. Raised when a Wave 285/286 sub-flow (insemination, BCS,
 * temperament, calving) is missing its required, actively-chosen field —
 * the server-side half of the "no pre-filled default counts as an answer"
 * contract.
 */
export class ReproFieldRequiredError extends Error {
  readonly code = 'REPRO_FIELD_REQUIRED' as const;
  constructor(message?: string) {
    super(
      message ??
        'Reproductive observation is missing a required field that must be actively selected.',
    );
    this.name = 'ReproFieldRequiredError';
  }
}

/**
 * Coerce a `details` payload into a plain object. The logger queue
 * `JSON.stringify`s `details` before POST, but a server caller could pass
 * an object directly. Anything that fails to parse is treated as empty,
 * which makes the empty-state check the single source of truth for the
 * `REPRO_REQUIRED` path.
 */
function coerceDetails(details: unknown): Record<string, unknown> | null {
  if (details === null || details === undefined) return null;
  if (typeof details === 'object') return details as Record<string, unknown>;
  if (typeof details === 'string') {
    if (details.length === 0) return null;
    try {
      const parsed = JSON.parse(details);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Truthy in the colloquial sense — `true`, `"true"`, `1`, `"1"`. */
function isTruthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return value === 'true' || value === '1';
  if (typeof value === 'number') return value === 1;
  return false;
}

/**
 * Count the number of mutually-exclusive reproductive states asserted by a
 * `details` payload, given the observation `type`.
 *
 * Returns 0 when the payload makes no state assertion at all (the
 * `REPRO_REQUIRED` rejection path), 1 for the happy path, ≥ 2 for
 * `REPRO_MULTI_STATE`.
 *
 * Assertion sources:
 *   - In Heat:   `details.method` present (`visual` | `scratch_card`)
 *                OR `details.in_heat` / `details.inHeat` truthy.
 *   - Pregnant:  (`type=pregnancy_scan` AND `details.result === 'pregnant'`)
 *                OR `details.pregnant` truthy.
 *   - Open:      (`type=pregnancy_scan` AND `details.result === 'empty'`)
 *                OR `details.open` truthy.
 *   - Uncertain: `type=pregnancy_scan` AND `details.result === 'uncertain'`.
 *                Treated as a single state (a recheck is scheduled — does
 *                NOT bypass the rule, but is not Pregnant/Open either).
 *
 * Each state is counted at most once even if it is restated by multiple
 * compatible markers (e.g. `details.result='pregnant'` + `details.pregnant=true`
 * is one Pregnant assertion, not two — the bug class is mixing DIFFERENT
 * states).
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

  // In Heat — method marker (the form's required field) OR explicit flag.
  if (typeof details.method === 'string' && details.method.length > 0) {
    inHeat = true;
  }
  if (isTruthyFlag(details.in_heat) || isTruthyFlag(details.inHeat)) {
    inHeat = true;
  }

  // pregnancy_scan.result — the canonical Pregnant / Open / Uncertain marker.
  if (type === 'pregnancy_scan' && typeof details.result === 'string') {
    if (details.result === 'pregnant') pregnant = true;
    else if (details.result === 'empty') open = true;
    else if (details.result === 'uncertain') uncertain = true;
  }

  // Boolean flag fallbacks — defends against stale clients that ship the
  // state as a top-level boolean instead of via `result`.
  if (isTruthyFlag(details.pregnant)) pregnant = true;
  if (isTruthyFlag(details.open)) open = true;

  return [inHeat, pregnant, open, uncertain].filter(Boolean).length;
}

/** Parse a `score`-like field into a finite number, or `null` if absent/NaN. */
function parseScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True when `value` is a non-empty, non-whitespace string. */
function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Required-field validation for the Wave 285/286 sub-flows. Each type has
 * exactly one actively-chosen answer that a pre-filled default must not be
 * able to fabricate. Throws `ReproFieldRequiredError` (422
 * REPRO_FIELD_REQUIRED) when the required field is absent or invalid.
 */
function validateRequiredField(
  type: string,
  details: Record<string, unknown> | null,
): void {
  if (type === 'insemination') {
    const method = details?.method;
    if (typeof method !== 'string' || !INSEM_METHODS.has(method)) {
      throw new ReproFieldRequiredError(
        'Insemination requires a service method of AI or natural.',
      );
    }
    return;
  }

  if (type === 'calving') {
    // #285 — calf identity is the required field. CalvingForm ships it as
    // `calfAnimalId`; the ReproductionForm calving sub-flow ships
    // `calf_tag`. Accept either so client & server agree on the contract.
    if (!hasText(details?.calf_tag) && !hasText(details?.calfAnimalId)) {
      throw new ReproFieldRequiredError(
        'Calving observation requires a calf ear tag (calf identity).',
      );
    }
    return;
  }

  // body_condition_score / temperament_score — bounded numeric score.
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
 * the route handler maps onto a 422 envelope.
 *
 * - `type` not in `REPRO_TYPES` → no-op (returns silently). This is the
 *   discipline that keeps the validator from blast-radiusing into Death,
 *   weighing, treatment, etc.
 * - Wave 285/286 required-field types (insemination, body_condition_score,
 *   temperament_score, calving) → missing/invalid required field throws
 *   `ReproFieldRequiredError` (422 REPRO_FIELD_REQUIRED).
 * - 0 state assertions → throw `ReproRequiredError` (422 REPRO_REQUIRED).
 * - >1 state assertions → throw `ReproMultiStateError` (422 REPRO_MULTI_STATE).
 * - Exactly 1 state assertion → return.
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
      type === 'pregnancy_scan'
        ? 'Pregnancy scan must include a result of pregnant, empty (Open), or uncertain.'
        : 'Reproductive observation must assert exactly one state (In Heat, Pregnant, or Open).',
    );
  }

  if (count > 1) {
    throw new ReproMultiStateError(
      'Reproductive observation cannot assert more than one of {In Heat, Pregnant, Open}.',
    );
  }
}
