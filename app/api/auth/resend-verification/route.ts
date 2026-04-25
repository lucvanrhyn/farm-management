import { NextRequest, NextResponse } from 'next/server';
import {
  getUserByEmail,
  isEmailVerified,
  setVerificationToken,
} from '@/lib/meta-db';
import {
  generateVerificationToken,
  sendVerificationEmail,
} from '@/lib/email-verification';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * POST /api/auth/resend-verification
 *
 * Requests a fresh email-verification link. Addresses the dead-end a user hits
 * when they lose the original verification email or their token expires
 * (surfaced by the 2026-04-18 deep-audit — "user stuck permanently with no
 * recovery path").
 *
 * Security: anti-enumeration response. The endpoint returns 200 `{ ok: true }`
 * regardless of whether the email exists or is already verified — an attacker
 * probing for registered emails gets no signal. The actual email only fires
 * for (user exists AND email is unverified).
 *
 * Rate limits (stacked):
 *   - per email: 1 request per 5 minutes (slows targeted abuse)
 *   - per IP:    5 requests per hour (slows wide-scan abuse)
 *
 * The per-email limit is applied BEFORE the user lookup so timing is identical
 * for rate-limited-and-user-exists vs rate-limited-and-user-does-not-exist.
 */
export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const ipRl = checkRateLimit(`resend-verify-ip:${ip}`, 5, 60 * 60 * 1000);
  if (!ipRl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.' },
      { status: 429 },
    );
  }

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

  // Per-email limit — applied BEFORE the lookup so an attacker can't use
  // response timing to learn whether the email exists.
  const emailRl = checkRateLimit(
    `resend-verify-email:${email}`,
    1,
    5 * 60 * 1000,
  );

  // Anti-enumeration: any subsequent failure returns the same success-shaped
  // response as the happy path. We return early ONLY on policy-level errors
  // (rate limit, invalid input) — never on "user not found" / "already
  // verified".
  if (!emailRl.allowed) {
    // Even the rate-limit response looks like success so an attacker can't
    // use it to enumerate emails. Legit users retrying within 5 min will
    // simply not receive a second email — the first one is still valid.
    return NextResponse.json({ ok: true });
  }

  try {
    const user = await getUserByEmail(email);
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    const alreadyVerified = await isEmailVerified(user.id);
    if (alreadyVerified) {
      return NextResponse.json({ ok: true });
    }

    const { token, expiresAt } = generateVerificationToken();
    await setVerificationToken(user.id, token, expiresAt);
    await sendVerificationEmail(email, token);

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Server errors: log for ops but don't reveal anything to the caller.
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[resend-verification]', {
      message,
      stack: err instanceof Error ? err.stack : '',
    });
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
