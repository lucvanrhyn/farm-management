/**
 * Auth error codes — client-safe constants.
 *
 * Extracted from `auth-options.ts` so client components can import the error
 * catalog without transitively pulling in server-only dependencies
 * (`bcryptjs`, `@libsql/client`, meta-db, next-auth internals). This file
 * has ZERO runtime imports — it's a pure constant.
 *
 * Security trade-off — EMAIL_NOT_VERIFIED:
 *   This code is only thrown AFTER a successful password comparison. It
 *   therefore reveals "user exists AND password is correct AND email is
 *   unverified". That's a minor account-enumeration vector vs. the old
 *   silent-null behaviour, but the rate limiter (10 attempts per minute
 *   per identifier) makes meaningful enumeration impractical, and the UX
 *   win for real users who can't figure out why login fails is
 *   significant. Industry-standard auth UIs (GitHub, Notion) make the
 *   same trade-off.
 */
export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  RATE_LIMITED: "RATE_LIMITED",
  SERVER_MISCONFIGURED: "SERVER_MISCONFIGURED",
  DB_UNAVAILABLE: "DB_UNAVAILABLE",
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
