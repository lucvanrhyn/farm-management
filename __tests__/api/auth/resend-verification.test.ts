import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks (declared before route import) ──────────────────────────────────────
const getUserByEmailMock = vi.fn();
const isEmailVerifiedMock = vi.fn();
const setVerificationTokenMock = vi.fn();
vi.mock('@/lib/meta-db', () => ({
  getUserByEmail: (...args: unknown[]) => getUserByEmailMock(...args),
  isEmailVerified: (...args: unknown[]) => isEmailVerifiedMock(...args),
  setVerificationToken: (...args: unknown[]) => setVerificationTokenMock(...args),
}));

const sendVerificationEmailMock = vi.fn();
const generateVerificationTokenMock = vi.fn((..._args: unknown[]) => ({
  token: 'tok-123',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
}));
vi.mock('@/lib/email-verification', () => ({
  generateVerificationToken: (...args: unknown[]) =>
    generateVerificationTokenMock(...args),
  sendVerificationEmail: (...args: unknown[]) =>
    sendVerificationEmailMock(...args),
}));

const checkRateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));

// Import AFTER mocks are registered.
const { POST } = await import('@/app/api/auth/resend-verification/route');

const allow = { allowed: true as const };
const deny = { allowed: false as const, retryAfterMs: 60_000 };

function makeReq(body: unknown, ip = '203.0.113.1'): NextRequest {
  return new NextRequest('https://example.com/api/auth/resend-verification', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/auth/resend-verification', () => {
  beforeEach(() => {
    getUserByEmailMock.mockReset();
    isEmailVerifiedMock.mockReset();
    setVerificationTokenMock.mockReset();
    sendVerificationEmailMock.mockReset();
    // Default both rate limiters to allow.
    checkRateLimitMock.mockReset().mockReturnValue(allow);
  });

  // ── Happy path ───────────────────────────────────────────────────────────────
  it('sends a fresh verification email when user exists and is unverified', async () => {
    getUserByEmailMock.mockResolvedValueOnce({
      id: 'user-1',
      email: 'luc@example.com',
      username: 'luc',
      passwordHash: 'h',
      name: 'Luc',
    });
    isEmailVerifiedMock.mockResolvedValueOnce(false);

    const res = await POST(makeReq({ email: 'luc@example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(setVerificationTokenMock).toHaveBeenCalledWith(
      'user-1',
      'tok-123',
      expect.any(String),
    );
    expect(sendVerificationEmailMock).toHaveBeenCalledWith(
      'luc@example.com',
      'tok-123',
    );
  });

  // ── Anti-enumeration: user not found ─────────────────────────────────────────
  it('returns 200 { ok: true } when user does not exist (no email sent)', async () => {
    getUserByEmailMock.mockResolvedValueOnce(null);

    const res = await POST(makeReq({ email: 'ghost@example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
  });

  // ── Anti-enumeration: already verified ───────────────────────────────────────
  it('returns 200 { ok: true } when user is already verified (no email sent)', async () => {
    getUserByEmailMock.mockResolvedValueOnce({
      id: 'user-2',
      email: 'done@example.com',
      username: 'done',
      passwordHash: 'h',
      name: 'Done',
    });
    isEmailVerifiedMock.mockResolvedValueOnce(true);

    const res = await POST(makeReq({ email: 'done@example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
    expect(setVerificationTokenMock).not.toHaveBeenCalled();
  });

  // ── Normalization: email is lowercased + trimmed ─────────────────────────────
  it('normalizes email (trim + lowercase) before lookup', async () => {
    getUserByEmailMock.mockResolvedValueOnce(null);
    await POST(makeReq({ email: '  LUC@Example.COM  ' }));
    expect(getUserByEmailMock).toHaveBeenCalledWith('luc@example.com');
  });

  // ── Input validation ─────────────────────────────────────────────────────────
  it('returns 400 when email is missing', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is not a valid address', async () => {
    const res = await POST(makeReq({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when request body is malformed JSON', async () => {
    const res = await POST(makeReq('{not json'));
    expect(res.status).toBe(400);
  });

  // ── IP rate limit ────────────────────────────────────────────────────────────
  it('returns 429 when per-IP rate limit is exceeded (keeps legit emails from 5+ drops/hour)', async () => {
    checkRateLimitMock.mockReturnValueOnce(deny); // IP check fires first

    const res = await POST(makeReq({ email: 'luc@example.com' }));

    expect(res.status).toBe(429);
    expect(getUserByEmailMock).not.toHaveBeenCalled();
    const [key, max, windowMs] = checkRateLimitMock.mock.calls[0] as [
      string,
      number,
      number,
    ];
    expect(key).toMatch(/^resend-verify-ip:/);
    expect(max).toBe(5);
    expect(windowMs).toBe(60 * 60 * 1000);
  });

  // ── Per-email rate limit ─────────────────────────────────────────────────────
  it('silently succeeds (200) when per-email rate limit is hit — anti-enumeration', async () => {
    // IP limit allows, per-email limit denies
    checkRateLimitMock.mockReturnValueOnce(allow).mockReturnValueOnce(deny);

    const res = await POST(makeReq({ email: 'luc@example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // No user lookup happens — anti-enum is preserved and no extra email sent.
    expect(getUserByEmailMock).not.toHaveBeenCalled();
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
    // Per-email key + 5-min window
    const [emailKey, emailMax, emailWindow] = checkRateLimitMock.mock
      .calls[1] as [string, number, number];
    expect(emailKey).toBe('resend-verify-email:luc@example.com');
    expect(emailMax).toBe(1);
    expect(emailWindow).toBe(5 * 60 * 1000);
  });

  // ── DB error ─────────────────────────────────────────────────────────────────
  it('returns 500 on unexpected DB failure (operator sees log, caller sees generic error)', async () => {
    getUserByEmailMock.mockRejectedValueOnce(new Error('meta-db offline'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeReq({ email: 'luc@example.com' }));

    expect(res.status).toBe(500);
    // Wave 4 G.4: route now logs through @/lib/logger which emits
    // `console.error(message, { message, stack })` in dev. The error
    // message + stack still flow through, just packaged in a payload.
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[resend-verification]'),
      expect.objectContaining({
        message: expect.stringContaining('meta-db offline'),
        stack: expect.any(String),
      }),
    );
    spy.mockRestore();
  });

  // ── Email send failure ───────────────────────────────────────────────────────
  it('returns 500 when sendVerificationEmail throws (RESEND_API_KEY missing, etc.)', async () => {
    getUserByEmailMock.mockResolvedValueOnce({
      id: 'user-1',
      email: 'luc@example.com',
      username: 'luc',
      passwordHash: 'h',
      name: 'Luc',
    });
    isEmailVerifiedMock.mockResolvedValueOnce(false);
    sendVerificationEmailMock.mockRejectedValueOnce(
      new Error('RESEND_API_KEY must be set'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeReq({ email: 'luc@example.com' }));

    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});
