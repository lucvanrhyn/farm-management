/**
 * Notification subsystem — typed error codes.
 *
 * Phase G fail-loud cure for the Phase J digest. Per
 * `memory/silent-failure-pattern.md`, every "config-missing → silent skip"
 * branch in the notification path must emit a typed code so operations can
 * grep / alert on the literal string from Vercel logs without parsing free
 * text.
 *
 * Conventions (mirrors `lib/auth-errors.ts` and `lib/server/farm-context-errors.ts`):
 *   - Codes are SCREAMING_SNAKE_CASE constants whose value matches the key.
 *   - The catalog is a frozen `as const` object so `keyof` derives the union
 *     and downstream code can switch exhaustively.
 *   - This module has ZERO runtime imports — safe to import from any layer
 *     (server route, Inngest function, React Server Component) without
 *     pulling transitive dependencies.
 *
 * Add new codes here as new silent-skip branches appear in the notification
 * path (e.g. push subscription provider misconfig, SMS gateway missing).
 * Do NOT inline string literals at call-sites — referencing the constant is
 * what lets `tsc` catch typos.
 */
export const NOTIFICATION_ERROR_CODES = {
  /**
   * Resend API key (`process.env.RESEND_API_KEY`) is unset on the runtime
   * the email sender is executing on. The cron MUST keep running, so we
   * `logger.warn` instead of throwing — operations sees a structured signal
   * and the rest of the dispatcher steps still execute.
   */
  RESEND_KEY_MISSING: "NOTIFICATION_RESEND_KEY_MISSING",

  /**
   * Resend's HTTP API returned a non-2xx (the SDK surfaces this on `res.error`).
   * The send didn't happen and the user expecting the digest won't get it.
   * We don't throw — the dispatcher records the reason in its result envelope
   * — but we DO emit a structured warn so the failure shows up in Vercel
   * logs alongside the typed code.
   */
  RESEND_API_FAILED: "NOTIFICATION_RESEND_API_FAILED",

  /**
   * Caller passed a `template` value that isn't in the renderer registry.
   * This should be unreachable via the TypeScript `EmailTemplate` union, but
   * JSON-driven sends (e.g. a future webhook handler) can reach it. Loud
   * warn so the regression is impossible to miss.
   */
  UNKNOWN_TEMPLATE: "NOTIFICATION_UNKNOWN_TEMPLATE",
} as const;

export type NotificationErrorCode =
  (typeof NOTIFICATION_ERROR_CODES)[keyof typeof NOTIFICATION_ERROR_CODES];
