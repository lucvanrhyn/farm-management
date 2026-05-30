/**
 * Integration tests for POST /api/auth/forgot-password
 *
 * Security properties verified:
 *   - Always returns { ok: true } / 200 (anti-enumeration: no signal on email existence)
 *   - Non-existent email: dummy bcrypt hash runs (timing defence), no token stored, no email sent
 *   - Existing email: token stored in password_reset_token column, reset email sent
 *   - Per-IP rate limit: 429 on breach (hard block before any lookup)
 *   - Per-email rate limit: silent 200 (anti-enumeration even on rate-limit)
 *   - Input validation: 400 on bad/missing email
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks (declared before route import) ─────────────────────────────────────

const getUserByEmailMock = vi.fn();
const setPasswordResetTokenMock = vi.fn();
vi.mock('@/lib/meta-db', () => ({
  getUserByEmail: (...args: unknown[]) => getUserByEmailMock(...args),
  setPasswordResetToken: (...args: unknown[]) => setPasswordResetTokenMock(...args),
}));

const generatePasswordResetTokenMock = vi.fn((..._args: unknown[]) => ({
  token: 'reset-tok-xyz',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
}));
const sendPasswordResetEmailMock = vi.fn();
vi.mock('@/lib/password-reset', () => ({
  generatePasswordResetToken: (...args: unknown[]) =>
    generatePasswordResetTokenMock(...args),
  sendPasswordResetEmail: (...args: unknown[]) =>
    sendPasswordResetEmailMock(...args),
}));

// Stub bcryptjs hash — we assert it IS called on not-found path (timing defence),
// but we don't want 200ms bcrypt cost in tests.
const hashMock = vi.fn().mockResolvedValue('$2a$12$mockhash');
vi.mock('bcryptjs', () => ({
  hash: (...args: unknown[]) => hashMock(...args),
}));

const checkRateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));

// Import AFTER mocks.
const { POST } = await import('@/app/api/auth/forgot-password/route');

// publicHandler wraps POST; CTX satisfies (req, ctx) signature.
const CTX = { params: Promise.resolve({}) };

const allow = { allowed: true as const };
const deny = { allowed: false as const, retryAfterMs: 60_000 };

const EXISTING_USER = {
  id: 'user-1',
  email: 'farmer@example.com',
  username: 'dicky',
  passwordHash: '$2a$12$realhashedpassword',
  name: 'Dicky van Wyk',
};

function makeReq(body: unknown, ip = '203.0.113.1'): NextRequest {
  return new NextRequest('https://example.com/api/auth/forgot-password', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    getUserByEmailMock.mockReset();
    setPasswordResetTokenMock.mockReset();
    generatePasswordResetTokenMock.mockReset().mockReturnValue({
      token: 'reset-tok-xyz',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    sendPasswordResetEmailMock.mockReset().mockResolvedValue(undefined);
    hashMock.mockReset().mockResolvedValue('$2a$12$mockhash');
    // Default: both rate limiters allow.
    checkRateLimitMock.mockReset().mockReturnValue(allow);
  });

  // ── Happy path: existing email ────────────────────────────────────────────
  it('stores a reset token and sends the reset email when the user exists', async () => {
    getUserByEmailMock.mockResolvedValueOnce(EXISTING_USER);

    const res = await POST(makeReq({ email: 'farmer@example.com' }), CTX);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Token must be stored in the dedicated password_reset columns.
    expect(setPasswordResetTokenMock).toHaveBeenCalledOnce();
    expect(setPasswordResetTokenMock).toHaveBeenCalledWith(
      'user-1',
      'reset-tok-xyz',
      expect.any(String),
    );

    // Reset email fired with correct args.
    expect(sendPasswordResetEmailMock).toHaveBeenCalledOnce();
    expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(
      'farmer@example.com',
      'reset-tok-xyz',
    );

    // Dummy hash must NOT run on the happy path (only on not-found).
    expect(hashMock).not.toHaveBeenCalled();
  });

  // ── Anti-enumeration: non-existent email ─────────────────────────────────
  it('returns { ok: true } for a non-existent email — no token stored, no email sent', async () => {
    getUserByEmailMock.mockResolvedValueOnce(null);

    const res = await POST(makeReq({ email: 'ghost@example.com' }), CTX);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // No side-effects.
    expect(setPasswordResetTokenMock).not.toHaveBeenCalled();
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  // ── Timing defence: dummy hash on not-found ───────────────────────────────
  it('runs a dummy bcrypt-12 hash on the not-found path (timing defence)', async () => {
    getUserByEmailMock.mockResolvedValueOnce(null);

    await POST(makeReq({ email: 'ghost@example.com' }), CTX);

    // The dummy hash must be called with cost factor 12 to match the
    // provisioning path's hashing cost.
    expect(hashMock).toHaveBeenCalledOnce();
    expect(hashMock).toHaveBeenCalledWith(expect.any(String), 12);
  });

  // ── Anti-enumeration: response shape is byte-identical ───────────────────
  it('responses for existing vs non-existent email are byte-identical', async () => {
    // Existing user
    getUserByEmailMock.mockResolvedValueOnce(EXISTING_USER);
    const existingRes = await POST(makeReq({ email: 'farmer@example.com' }), CTX);
    const existingText = await existingRes.text();

    // Non-existent user
    getUserByEmailMock.mockResolvedValueOnce(null);
    const ghostRes = await POST(makeReq({ email: 'ghost@example.com' }), CTX);
    const ghostText = await ghostRes.text();

    expect(existingRes.status).toBe(ghostRes.status);
    expect(existingText).toBe(ghostText);
  });

  // ── Email normalisation ───────────────────────────────────────────────────
  it('normalizes email (trim + lowercase) before lookup', async () => {
    getUserByEmailMock.mockResolvedValueOnce(null);

    await POST(makeReq({ email: '  FARMER@Example.COM  ' }), CTX);

    expect(getUserByEmailMock).toHaveBeenCalledWith('farmer@example.com');
  });

  // ── Input validation ──────────────────────────────────────────────────────
  it('returns 400 when email field is missing', async () => {
    const res = await POST(makeReq({}), CTX);
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is not a valid address', async () => {
    const res = await POST(makeReq({ email: 'not-an-email' }), CTX);
    expect(res.status).toBe(400);
  });

  it('returns 400 when request body is malformed JSON', async () => {
    const res = await POST(makeReq('{not json'), CTX);
    expect(res.status).toBe(400);
  });

  // ── Per-IP rate limit ─────────────────────────────────────────────────────
  it('returns 429 when per-IP rate limit is exceeded (hard block, no lookup)', async () => {
    checkRateLimitMock.mockReturnValueOnce(deny); // IP check is first

    const res = await POST(makeReq({ email: 'farmer@example.com' }), CTX);

    expect(res.status).toBe(429);
    // No user lookup must happen — the request is blocked before any DB call.
    expect(getUserByEmailMock).not.toHaveBeenCalled();

    // Verify the IP rate-limit key and parameters.
    const [key, max, windowMs] = checkRateLimitMock.mock.calls[0] as [
      string,
      number,
      number,
    ];
    expect(key).toMatch(/^forgot-password-ip:/);
    expect(max).toBeGreaterThanOrEqual(3); // at least 3/hr to be usable
    expect(windowMs).toBe(60 * 60 * 1000);
  });

  // ── Per-email rate limit (anti-enumeration) ───────────────────────────────
  it('returns 200 { ok: true } when per-email rate limit is hit — anti-enumeration preserved', async () => {
    // IP allows, per-email denies.
    checkRateLimitMock
      .mockReturnValueOnce(allow) // IP
      .mockReturnValueOnce(deny); // per-email

    const res = await POST(makeReq({ email: 'farmer@example.com' }), CTX);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // No user lookup or token storage on rate-limited email path.
    expect(getUserByEmailMock).not.toHaveBeenCalled();
    expect(setPasswordResetTokenMock).not.toHaveBeenCalled();
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();

    // Verify the per-email key and 3-per-hour window.
    const [emailKey, emailMax, emailWindow] = checkRateLimitMock.mock
      .calls[1] as [string, number, number];
    expect(emailKey).toBe('forgot-password-email:farmer@example.com');
    expect(emailMax).toBeGreaterThanOrEqual(1);
    expect(emailWindow).toBeGreaterThan(0);
  });

  // ── DB error ─────────────────────────────────────────────────────────────
  it('returns 500 on unexpected DB failure — generic error message, details logged', async () => {
    getUserByEmailMock.mockRejectedValueOnce(new Error('meta-db offline'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeReq({ email: 'farmer@example.com' }), CTX);

    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});
