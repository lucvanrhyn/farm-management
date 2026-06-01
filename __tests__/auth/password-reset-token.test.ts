/**
 * Unit tests for lib/password-reset.ts
 *
 * Covers:
 *   - generatePasswordResetToken: mints a UUID + 24h expiry
 *   - sendPasswordResetEmail: delegates to sendEmail with the correct template + link
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock sendEmail ────────────────────────────────────────────────────────────
const sendEmailMock = vi.fn();
vi.mock('@/lib/server/send-email', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

// Import AFTER mocks.
const { generatePasswordResetToken, sendPasswordResetEmail } = await import(
  '@/lib/password-reset'
);

describe('generatePasswordResetToken()', () => {
  it('returns a non-empty string token (UUID format)', () => {
    const { token } = generatePasswordResetToken();
    // randomUUID() produces xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('returns an expiresAt ISO string approximately 24 hours from now', () => {
    const before = Date.now();
    const { expiresAt } = generatePasswordResetToken();
    const after = Date.now();

    const expMs = new Date(expiresAt).getTime();
    const expectedMin = before + 24 * 60 * 60 * 1000;
    const expectedMax = after + 24 * 60 * 60 * 1000;

    expect(expMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expMs).toBeLessThanOrEqual(expectedMax);
  });

  it('returns a different token on each call (no deduplication collision)', () => {
    const a = generatePasswordResetToken();
    const b = generatePasswordResetToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe('sendPasswordResetEmail()', () => {
  beforeEach(() => {
    sendEmailMock.mockReset().mockResolvedValue({ sent: true, id: 'email-id-1' });
  });

  it('calls sendEmail with the password-reset template and correct data', async () => {
    await sendPasswordResetEmail('farmer@example.com', 'tok-abc-123');

    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: 'farmer@example.com',
      template: 'password-reset',
      data: { token: 'tok-abc-123' },
    });
  });

  it('resolves without throwing on a successful send', async () => {
    await expect(
      sendPasswordResetEmail('farmer@example.com', 'tok-abc-123'),
    ).resolves.toBeUndefined();
  });

  it('resolves without throwing when sendEmail returns skipped (no-api-key) — silent-skip policy', async () => {
    sendEmailMock.mockResolvedValueOnce({ sent: false, skipped: 'no-api-key' });
    // Unlike sendVerificationEmail (which throws on missing key), the password-reset
    // mailer follows the silent-skip policy — callers return { ok: true } regardless.
    await expect(
      sendPasswordResetEmail('farmer@example.com', 'tok-abc-123'),
    ).resolves.toBeUndefined();
  });

  it('throws when sendEmail returns a send failure (Resend API error)', async () => {
    sendEmailMock.mockResolvedValueOnce({ sent: false, error: 'Resend 429' });
    await expect(
      sendPasswordResetEmail('farmer@example.com', 'tok-abc-123'),
    ).rejects.toThrow('Failed to send password reset email');
  });
});
