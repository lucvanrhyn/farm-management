/**
 * Issue #485 — shared pagination-limit validator.
 *
 * Single owner of the `?limit` query-param contract for every list
 * endpoint (animals / observations / tasks). Before this module the same
 * bad `?limit` produced THREE divergent answers:
 *   - /api/animals      → `{ error: "Invalid limit" }` 400 (free-text literal)
 *   - /api/observations → SILENTLY clamped to the default (never rejected)
 *   - /api/tasks        → `{ error: "INVALID_LIMIT" }` 400 (typed — the model)
 *
 * `parseLimit` converges them onto the tasks contract: a non-finite / ≤0
 * limit throws the canonical `InvalidLimitError`, which `mapApiDomainError`
 * (`lib/server/api-errors.ts`) maps to `{ error: "INVALID_LIMIT" }` 400 — the
 * route adapters (`tenantRead`) run any thrown handler error through that
 * mapper, so each route only needs to `parseLimit(...)` and let it throw.
 *
 * The per-route cap is supplied by the caller (animals 2000, observations
 * 200, tasks 500) so VALID-input behaviour is unchanged route-by-route; only
 * the INVALID-input contract is unified.
 *
 * `InvalidLimitError` / `INVALID_LIMIT` originated in the tasks domain
 * (`lib/domain/tasks/errors.ts`) and now live here as the canonical
 * definition; the tasks module re-exports them so existing imports — and the
 * `instanceof` check in `mapApiDomainError` — keep their single identity.
 */

export const INVALID_LIMIT = "INVALID_LIMIT" as const;

/**
 * `limit` query-param is not a positive finite integer. Wire: 400
 * `{ error: "INVALID_LIMIT" }`.
 */
export class InvalidLimitError extends Error {
  readonly code = INVALID_LIMIT;
  readonly received: string;
  constructor(received: string) {
    super(`Invalid limit: ${received}`);
    this.name = "InvalidLimitError";
    this.received = received;
  }
}

export interface ParseLimitOptions {
  /** Per-route hard cap. A valid limit above this clamps down to it. */
  max: number;
  /** Value used when the param is absent / empty (NOT an error). */
  fallback: number;
}

/**
 * Parse and validate a `?limit` query-param value.
 *
 * - `null` / `""` (omitted)      → `fallback`
 * - non-finite integer or `≤ 0`  → throws `InvalidLimitError`
 * - valid positive integer       → `Math.min(parsed, max)`
 */
export function parseLimit(
  raw: string | null,
  opts: ParseLimitOptions,
): number {
  if (raw === null || raw === "") {
    return opts.fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidLimitError(raw);
  }

  return Math.min(parsed, opts.max);
}
