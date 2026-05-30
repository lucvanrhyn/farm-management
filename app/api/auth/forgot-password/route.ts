// app/api/auth/forgot-password/route.ts — Slice 1 of issue #102.
//
// POST { email } → always returns { ok: true } (anti-enumeration).
//
// Security guarantees:
//   - Anti-enumeration: 200 { ok: true } regardless of whether the email
//     exists — an attacker probing registered emails gets no signal.
//   - Timing defence: on not-found, runs a dummy bcrypt-12 hash so latency
//     matches the happy path (which also calls into bcrypt indirectly via the
//     provisioning stack). bcrypt at cost 12 dominates wall-clock (~200 ms),
//     flattening the distinguishable gap.
//   - Separate reset-token columns: stores into password_reset_token /
//     password_reset_expires — NOT the email-verification columns — to prevent
//     cross-purpose token replay (a verify token cannot be accepted at
//     /api/auth/reset-password and vice versa). See PR #102a security decision.
//   - Stacked rate limits:
//       - Per-IP:    5 req/hr   → hard 429 block (attacker-scanner defence)
//       - Per-email: 3 req/hr   → silent 200 (anti-enum, legit-retry defence)
//     Per-email limit applied BEFORE user lookup so timing is identical for
//     rate-limited-and-user-exists vs rate-limited-and-user-does-not-exist.
//
// Slice 2 (reset-confirm: PATCH { token, newPassword }) stacks on this branch.

import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';

import { getUserByEmail, setPasswordResetToken } from '@/lib/meta-db';
import { generatePasswordResetToken, sendPasswordResetEmail } from '@/lib/password-reset';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { publicHandler } from '@/lib/server/route';

export const POST = publicHandler({
  handle: async (request: NextRequest) => {
    // ── Per-IP rate limit (hard block) ─────────────────────────────────────
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
    const ipRl = checkRateLimit(`forgot-password-ip:${ip}`, 5, 60 * 60 * 1000);
    if (!ipRl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Try again later.' },
        { status: 429 },
      );
    }

    // ── Parse + validate body ───────────────────────────────────────────────
    let body: { email?: string };
    try {
      body = (await request.json()) as { email?: string };
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON' },
        { status: 400 },
      );
    }

    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 },
      );
    }

    // ── Per-email rate limit (silent — anti-enumeration preserved) ──────────
    const emailRl = checkRateLimit(
      `forgot-password-email:${email}`,
      3,
      60 * 60 * 1000,
    );
    if (!emailRl.allowed) {
      // Return the same success shape so an attacker cannot use rate-limit
      // signals to enumerate whether an email is registered.
      return NextResponse.json({ ok: true });
    }

    // ── Main flow ───────────────────────────────────────────────────────────
    try {
      const user = await getUserByEmail(email);

      if (!user) {
        // Anti-enumeration timing defence: run a dummy bcrypt hash so the
        // "email not found" path spends roughly the same CPU as the happy
        // path which calls generatePasswordResetToken + setPasswordResetToken
        // + sendPasswordResetEmail. bcrypt at cost 12 dominates wall-clock.
        // We discard the result — this is purely for timing equalization.
        await hash('dummy-timing-defence', 12);
        return NextResponse.json({ ok: true });
      }

      // Mint a fresh token and persist it in the dedicated reset columns.
      const { token, expiresAt } = generatePasswordResetToken();
      await setPasswordResetToken(user.id, token, expiresAt);

      // Send the reset email. sendPasswordResetEmail follows silent-skip on
      // missing RESEND_API_KEY (dev/test env) — throws only on Resend API
      // failures when the key IS present.
      await sendPasswordResetEmail(email, token);

      return NextResponse.json({ ok: true });
    } catch (err) {
      // Server errors: log for ops but do not reveal anything to the caller.
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[forgot-password]', {
        message,
        stack: err instanceof Error ? err.stack : '',
      });
      return NextResponse.json(
        { error: 'Something went wrong. Please try again.' },
        { status: 500 },
      );
    }
  },
});
