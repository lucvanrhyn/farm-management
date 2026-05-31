// lib/password-reset.ts — Password-reset token helper (issue #102 slice 1).
//
// Mirrors lib/email-verification.ts but uses separate columns
// (password_reset_token / password_reset_expires) to avoid cross-purpose
// token-confusion between the email-verify and password-reset flows.
// See ADR decision recorded in PR #102a.

import { randomUUID } from 'crypto';
import { sendEmail } from '@/lib/server/send-email';

/**
 * Mint a one-time password-reset token valid for 24 hours.
 * Uses randomUUID() (cryptographically random 128-bit) — same entropy source
 * as the email-verification token.
 */
export function generatePasswordResetToken(): { token: string; expiresAt: string } {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  return { token, expiresAt };
}

/**
 * Send the password-reset email via the centralised sendEmail transport.
 *
 * Unlike sendVerificationEmail, this follows the silent-skip policy on a
 * missing RESEND_API_KEY: the route always returns { ok: true } regardless
 * of email-send outcome (anti-enumeration contract). However, a Resend API
 * rejection (key present but send fails) is surfaced as a thrown error so
 * the route's catch block can log it for operator visibility.
 *
 * Not throwing on no-api-key avoids a config-missing boot error in dev/test
 * environments that haven't set up email.
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string,
): Promise<void> {
  const result = await sendEmail({
    to: email,
    template: 'password-reset',
    data: { token },
  });

  // Silent skip when no API key — dev/test environments without email config
  // should not blow up the auth flow (the route returns ok:true regardless).
  if (result.skipped === 'no-api-key') {
    return;
  }

  if (!result.sent) {
    throw new Error(
      `Failed to send password reset email: ${result.error ?? 'unknown error'}`,
    );
  }
}
