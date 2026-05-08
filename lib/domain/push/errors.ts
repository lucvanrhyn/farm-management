/**
 * Wave F (#163) — domain-layer typed errors for `lib/domain/push/*`.
 *
 * Each error wraps a SCREAMING_SNAKE wire code mapped via
 * `mapApiDomainError` at `lib/server/api-errors.ts`. Wire shape replaces
 * pre-Wave-F free-text strings:
 *
 *   400 "Invalid subscription" → 400 INVALID_SUBSCRIPTION
 *   400 "Missing endpoint"     → 400 MISSING_ENDPOINT
 */

export const INVALID_SUBSCRIPTION = "INVALID_SUBSCRIPTION" as const;
export const MISSING_ENDPOINT = "MISSING_ENDPOINT" as const;

/**
 * Subscribe payload was missing `endpoint`, `keys.p256dh`, or `keys.auth`.
 * Wire: 400 `{ error: "INVALID_SUBSCRIPTION" }`.
 */
export class InvalidSubscriptionError extends Error {
  readonly code = INVALID_SUBSCRIPTION;
  constructor() {
    super("Push subscription payload missing endpoint or keys");
    this.name = "InvalidSubscriptionError";
  }
}

/**
 * Unsubscribe payload was missing `endpoint`. Wire: 400
 * `{ error: "MISSING_ENDPOINT" }`.
 */
export class MissingEndpointError extends Error {
  readonly code = MISSING_ENDPOINT;
  constructor() {
    super("Unsubscribe payload missing endpoint");
    this.name = "MissingEndpointError";
  }
}
