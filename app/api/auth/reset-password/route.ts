// app/api/auth/reset-password/route.ts — Slice 2 of issue #102.
//
// POST { token, password, passwordConfirm }
//   → { valid: true }  (200)  — password updated, token invalidated
//   → { valid: false } (200)  — token absent, expired, or already used
//   → { error }        (400)  — validation failure (before any DB call)
//   → { error }        (500)  — unexpected server error
//
// Security guarantees:
//
//   Expiry enforcement (slice-1 residual):
//     consumePasswordResetToken does an atomic
//     `SELECT … WHERE token = ? AND expires > now` — an expired token is
//     indistinguishable from an absent one; both return { valid: false }.
//
//   Single-use invalidation (slice-1 residual):
//     consumePasswordResetToken clears the token columns on first use.
//     A replay within the 24h window returns { valid: false } on the second
//     call, preventing any attacker who obtained a link from reusing it after
//     the legitimate user has already reset their password.
//
//   Validation before token consume:
//     Password length + confirm-match are checked BEFORE any DB call so a
//     bad-password submission does NOT burn the one-time token.
//
//   No enumeration via token lookup:
//     All non-valid token paths return HTTP 200 { valid: false } so the browser
//     never auto-logs a "Failed to load resource" network error, and callers
//     cannot distinguish absent vs expired vs replayed via status code.
//
//   bcrypt cost 12:
//     Matches the cost used at registration (app/api/auth/register/route.ts:95).
//
//   Session invalidation residual:
//     Existing JWT sessions survive to their 8h expiry after a successful reset.
//     Full session revocation requires a token-version column on users + a
//     compare in the JWT callback — that is OUT OF SCOPE for this slice and
//     tracked as a follow-up on issue #102. The 8h JWT window is short enough
//     to be acceptable for the current threat model.

import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';

import { consumePasswordResetToken, resetUserPassword } from '@/lib/meta-db';
import { logger } from '@/lib/logger';
import { publicHandler, routeError } from '@/lib/server/route';

const PASSWORD_MIN_LENGTH = 8;

export const POST = publicHandler({
  handle: async (request: NextRequest) => {
    // ── Parse body ───────────────────────────────────────────────────────────
    let body: { token?: string; password?: string; passwordConfirm?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return routeError('INVALID_BODY', 'Request body must be valid JSON');
    }

    const { token, password, passwordConfirm } = body;

    // ── Validation (BEFORE token consume) ───────────────────────────────────
    // Check password requirements first so a bad submission does not consume
    // the one-time token.

    if (!token || typeof token !== 'string' || !token.trim()) {
      return routeError('VALIDATION_FAILED', 'token is required');
    }

    if (!password || typeof password !== 'string') {
      return routeError('VALIDATION_FAILED', 'password is required');
    }

    if (!passwordConfirm || typeof passwordConfirm !== 'string') {
      return routeError('VALIDATION_FAILED', 'passwordConfirm is required');
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      return routeError(
        'VALIDATION_FAILED',
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      );
    }

    if (password !== passwordConfirm) {
      return routeError('VALIDATION_FAILED', 'Passwords do not match');
    }

    // ── Atomic token consume + expiry check ──────────────────────────────────
    // consumePasswordResetToken returns null for: absent, expired, or already-used.
    // All three collapse to { valid: false } (200) — no enumeration signal.
    try {
      const consumed = await consumePasswordResetToken(token.trim());

      if (!consumed) {
        return NextResponse.json({ valid: false }, { status: 200 });
      }

      // ── Hash + persist ───────────────────────────────────────────────────
      // bcrypt cost 12 matches app/api/auth/register/route.ts:95.
      const passwordHash = await hash(password, 12);

      // Single atomic UPDATE: sets the new hash and clears the reset columns
      // (belt-and-suspenders — the consume step already cleared them, but this
      // keeps the invariant watertight against any future refactor).
      await resetUserPassword(consumed.userId, passwordHash);

      return NextResponse.json({ valid: true }, { status: 200 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[reset-password]', {
        message,
        stack: err instanceof Error ? err.stack : '',
      });
      return routeError('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
    }
  },
});
