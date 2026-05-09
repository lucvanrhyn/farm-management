import { NextRequest, NextResponse } from 'next/server';
import { compareSync } from 'bcryptjs';
import { getUserByIdentifier, isEmailVerified } from '@/lib/meta-db';
import { checkRateLimit } from '@/lib/rate-limit';
import { AUTH_ERROR_CODES, type AuthErrorCode } from '@/lib/auth-errors';
import { logger } from '@/lib/logger';
import { publicHandler } from '@/lib/server/route';

/**
 * P1 — pre-flight credential check that ALWAYS returns HTTP 200 (or 500 for
 * true server errors) with a typed JSON payload.
 *
 * Why this exists: NextAuth's `/api/auth/callback/credentials` returns 401 on
 * invalid credentials, and the browser's network layer auto-emits "Failed to
 * load resource: the server responded with a status of 401" to the console
 * BEFORE app code can intercept. Same root-cause class as the A.2 verify-email
 * fix (commit a0fe84c).
 *
 * Flow: login page POSTs identifier+password here first. On `{ ok: true }`
 * the page then calls `signIn("credentials", ...)`, which hits authorize()
 * with the same valid creds and succeeds — no 401. On `{ ok: false }` the
 * page renders the user-facing error and never invokes signIn.
 *
 * Logic mirrors the authorize() callback in lib/auth-options.ts. The duplication
 * is intentional: keeping authOptions untouched isolates the network-layer
 * fix from NextAuth's session machinery.
 *
 * Wave H2 (#174) — wrapped in `publicHandler` for typed-error envelope on
 * unexpected throws + observability. The route's own anti-enumeration model
 * (always 200 with `{ ok, reason }` for normal user input) is preserved
 * verbatim inside `handle`. The adapter only intervenes when the handler
 * itself throws unexpectedly.
 */

type LoginCheckResponse =
  | { ok: true }
  | { ok: false; reason: AuthErrorCode };

function payload(body: LoginCheckResponse, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export const POST = publicHandler({
  handle: async (request: NextRequest) => {
    let body: { identifier?: unknown; password?: unknown };
    try {
      body = await request.json();
    } catch {
      // Malformed JSON → treat as missing credentials (still 200 + typed).
      return payload({ ok: false, reason: AUTH_ERROR_CODES.INVALID_CREDENTIALS });
    }

    const identifier =
      typeof body.identifier === 'string' ? body.identifier : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!identifier || !password) {
      return payload({ ok: false, reason: AUTH_ERROR_CODES.INVALID_CREDENTIALS });
    }

    // Rate limit: 10 attempts per minute per identifier (same window/key as
    // authorize() so brute-force protection is unaffected by the new route).
    const rl = checkRateLimit(`login:${identifier}`, 10, 60_000);
    if (!rl.allowed) {
      return payload({ ok: false, reason: AUTH_ERROR_CODES.RATE_LIMITED });
    }

    // Meta-db lookup. A real DB error is a true server fault → 500. Wrong
    // password / missing user is normal user input → 200 + typed reason.
    let user: Awaited<ReturnType<typeof getUserByIdentifier>>;
    try {
      user = await getUserByIdentifier(identifier);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? (err.stack ?? '') : '';
      logger.error('[login-check] meta DB error', { message, stack });

      if (/must be set in environment variables/i.test(message)) {
        return payload(
          { ok: false, reason: AUTH_ERROR_CODES.SERVER_MISCONFIGURED },
          500,
        );
      }
      return payload(
        { ok: false, reason: AUTH_ERROR_CODES.DB_UNAVAILABLE },
        500,
      );
    }

    if (!user) {
      // Generic — avoids account enumeration.
      return payload({ ok: false, reason: AUTH_ERROR_CODES.INVALID_CREDENTIALS });
    }

    const valid = compareSync(password, user.passwordHash);
    if (!valid) {
      return payload({ ok: false, reason: AUTH_ERROR_CODES.INVALID_CREDENTIALS });
    }

    // Email verification — only checked for users that have an email
    // (LOGGER-role users are auto-verified at creation and have null email).
    if (user.email) {
      let verified: boolean;
      try {
        verified = await isEmailVerified(user.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[login-check] email verification check failed', { message });
        return payload(
          { ok: false, reason: AUTH_ERROR_CODES.DB_UNAVAILABLE },
          500,
        );
      }
      if (!verified) {
        return payload({
          ok: false,
          reason: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
        });
      }
    }

    return payload({ ok: true });
  },
});
