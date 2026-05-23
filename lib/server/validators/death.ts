/**
 * Wave 3b / #254 (PRD #250) — `DeathObservationValidator`.
 *
 * Server-side defense-in-depth for the Death logger form. Mirrors the
 * #253 reproductive-state validator one-for-one — same shape, same
 * scope-discipline contract, same hand-rolled style (no `zod` runtime dep,
 * matches the duck-typed `parse()` schemas already in the route file).
 *
 * The bug class:
 *   The pre-#254 Death modal was a single-pick cause selector that fired
 *   `onSelect(cause)` directly with no disposal field at all. A stale
 *   client could POST `{ cause: ['Disease', 'Predator'] }` and there was
 *   no SARS / NSPCA-required carcass-disposal data on the row.
 *
 * The fix is layered:
 *   1. UI: a single radio for cause + a required <Select /> for disposal —
 *      owned by `components/logger/DeathModal.tsx`.
 *   2. Server: this validator. Even a stale or malicious client cannot
 *      bypass the rule, because `app/api/observations/route.ts` invokes
 *      `validateDeathObservation` on every death POST and rejects with
 *      `422 { error: DEATH_MULTI_CAUSE }` or
 *      `422 { error: DEATH_DISPOSAL_REQUIRED }` before the row hits Prisma.
 *
 * Scope discipline:
 *   The shared route POST is wired across every observation type. To keep
 *   Wave 3b from colliding with PRD #253 (Reproduction) and any future
 *   wave, the public entry point is `validateDeathObservation(details)` —
 *   the route handler is responsible for gating it on `body.type === 'death'`.
 *   This is symmetric with `validateReproductiveState` which gates itself
 *   internally on `REPRO_TYPES.has(type)`. The route's POST handler always
 *   gates on type before invoking either validator.
 *
 * Enum lock (HITL #254):
 *   `CARCASS_DISPOSAL_VALUES` is the maintainer-locked set
 *   {BURIED, BURNED, RENDERED, OTHER}. Adding or renaming a value MUST be
 *   a separate HITL decision — the test in
 *   `__tests__/api/observations/death-validator.test.ts` pins the exact
 *   tuple so a drift PR fails CI.
 */

/**
 * Maintainer-locked enum (HITL #254). Regulatory-safe initial set per
 * SARS / NSPCA conventions. Mirrored verbatim in:
 *   - the migration file (`migrations/0021_death_carcass_disposal.sql`)
 *   - the UI <Select /> options (`components/logger/DeathModal.tsx`)
 *   - this validator's `VALID_DISPOSALS` set
 */
export const CARCASS_DISPOSAL_VALUES = ['BURIED', 'BURNED', 'RENDERED', 'OTHER'] as const;

export type CarcassDisposal = (typeof CARCASS_DISPOSAL_VALUES)[number];

const VALID_DISPOSALS: ReadonlySet<string> = new Set(CARCASS_DISPOSAL_VALUES);

/** Typed error → mapped to `422 { error: "DEATH_MULTI_CAUSE" }` by the route. */
export class DeathMultiCauseError extends Error {
  readonly code = 'DEATH_MULTI_CAUSE' as const;
  constructor(message?: string) {
    super(message ?? 'Death observation cannot assert more than one cause.');
    this.name = 'DeathMultiCauseError';
  }
}

/** Typed error → mapped to `422 { error: "DEATH_DISPOSAL_REQUIRED" }` by the route. */
export class DeathDisposalRequiredError extends Error {
  readonly code = 'DEATH_DISPOSAL_REQUIRED' as const;
  constructor(message?: string) {
    super(
      message ??
        `Death observation requires carcassDisposal to be one of: ${CARCASS_DISPOSAL_VALUES.join(', ')}.`,
    );
    this.name = 'DeathDisposalRequiredError';
  }
}

/**
 * Coerce a `details` payload into a plain object. The logger queue
 * `JSON.stringify`s `details` before POST, but a server caller could pass
 * an object directly. Anything that fails to parse is treated as empty,
 * which makes the disposal-required check the single source of truth for
 * the `DEATH_DISPOSAL_REQUIRED` empty-payload path.
 *
 * Symmetric with `coerceDetails` in `reproductive-state.ts`.
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

/**
 * Count distinct cause assertions on a death-observation payload.
 *
 * Assertion sources (any combination — but the count is the union):
 *   - `details.cause` as a string → 1 assertion.
 *   - `details.cause` as a string[] → length of the array.
 *   - `details.causes` as a string[] → length of the array.
 *   - `details.cause` (string) + `details.causes` (array) → sum.
 *
 * The rule is: a payload that asserts more than one cause is rejected
 * even if the duplication is structural (e.g. `cause: 'X', causes: ['X']`
 * still counts as 2 because we cannot reliably dedupe across schemas
 * without losing the data-loss signal). Single-element `causes` arrays
 * are explicitly handled as 1 (so `causes: ['Disease']` passes — it's
 * the multi-cause class we're locking out, not array-vs-scalar drift).
 *
 * Returns 0 when the payload makes no cause assertion at all (treated
 * as a soft-empty path that does NOT reject — the disposal-required
 * check is the one that fires for empty payloads).
 */
function countCauses(details: Record<string, unknown> | null): number {
  if (!details) return 0;

  let count = 0;

  if (typeof details.cause === 'string' && details.cause.length > 0) {
    count += 1;
  } else if (Array.isArray(details.cause)) {
    count += details.cause.filter((c) => typeof c === 'string' && c.length > 0).length;
  }

  if (Array.isArray(details.causes)) {
    count += details.causes.filter((c) => typeof c === 'string' && c.length > 0).length;
  }

  return count;
}

/**
 * Validate a death observation payload. Throws a typed error that the
 * route handler maps onto a 422 envelope.
 *
 * Order matters: multi-cause is checked first because it is the more
 * dangerous bug (silent data loss of cause information). Disposal-required
 * is checked second because an empty payload reads as "no cause + no
 * disposal" and the user-facing fix is to pick both.
 *
 * - >1 cause assertions → throw `DeathMultiCauseError` (422 DEATH_MULTI_CAUSE).
 * - 0 cause assertions  → fall through to the disposal check (an empty
 *                         payload should fail with DEATH_DISPOSAL_REQUIRED,
 *                         which is the closer-to-actionable message).
 * - carcassDisposal missing or not in the canonical enum →
 *   throw `DeathDisposalRequiredError` (422 DEATH_DISPOSAL_REQUIRED).
 * - Exactly 1 cause + valid disposal → return.
 */
export function validateDeathObservation(details: unknown): void {
  const parsed = coerceDetails(details);

  const causeCount = countCauses(parsed);
  if (causeCount > 1) {
    throw new DeathMultiCauseError(
      'Death observation cannot assert more than one cause. Pick exactly one (Disease, Predator, Accident, Old age, Stillbirth, or Other).',
    );
  }

  const disposal = parsed?.carcassDisposal;
  if (typeof disposal !== 'string' || !VALID_DISPOSALS.has(disposal)) {
    throw new DeathDisposalRequiredError();
  }
}
