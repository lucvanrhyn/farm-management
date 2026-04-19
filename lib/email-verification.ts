import { randomUUID } from 'crypto';
import { sendEmail } from '@/lib/server/send-email';

export function generateVerificationToken(): { token: string; expiresAt: string } {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  return { token, expiresAt };
}

/**
 * Sends the account-verification email. Throws on Resend-level failure so
 * the existing callers (registration flow) surface the error — this matches
 * the prior API where a missing key threw loudly. The generalised
 * sendEmail() returns a skipped/error result instead of throwing, so we
 * re-throw here to preserve the original contract.
 */
export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const result = await sendEmail({
    to: email,
    template: 'verify-email',
    data: { token },
  });
  if (result.skipped === 'no-api-key') {
    throw new Error('RESEND_API_KEY must be set in environment variables.');
  }
  if (!result.sent) {
    throw new Error(`Failed to send verification email: ${result.error ?? 'unknown error'}`);
  }
}
