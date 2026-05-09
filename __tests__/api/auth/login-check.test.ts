import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * P1 — `/api/auth/login-check` returns HTTP 200 with a typed payload so the
 * browser network layer never auto-emits "Failed to load resource: 401" to
 * the console on wrong-credentials. The page calls this BEFORE invoking
 * NextAuth's `signIn()` and only proceeds to signIn on `{ ok: true }`.
 *
 * Same root-cause class as the A.2 verify-email fix (commit a0fe84c):
 * browsers log every non-2xx response BEFORE app code can intercept.
 */

// ─── Mocks (declared before route import) ───────────────────────────────────
vi.mock('bcryptjs', () => ({ compareSync: vi.fn() }));

const getUserByIdentifierMock = vi.fn();
const isEmailVerifiedMock = vi.fn();
vi.mock('@/lib/meta-db', () => ({
  getUserByIdentifier: (...args: unknown[]) => getUserByIdentifierMock(...args),
  isEmailVerified: (...args: unknown[]) => isEmailVerifiedMock(...args),
}));

const checkRateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));

import { compareSync } from 'bcryptjs';
const { POST } = await import('@/app/api/auth/login-check/route');
const { AUTH_ERROR_CODES } = await import('@/lib/auth-errors');

// Wave H2 (#174) — POST is now wrapped in `publicHandler`, so its signature
// is `(req, ctx)`. The adapter tolerates an empty params context (no dynamic
// segments) — every test below passes this `CTX` to satisfy the type.
const CTX = { params: Promise.resolve({}) };

function buildRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/auth/login-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const VALID = { identifier: 'dicky', password: 'correct-horse' };
const STORED_USER = {
  id: 'user-1',
  email: 'dicky@triob.co.za',
  username: 'dicky',
  passwordHash: '$2a$12$hashedpassword',
  name: 'Dicky',
};

describe('POST /api/auth/login-check', () => {
  beforeEach(() => {
    getUserByIdentifierMock.mockReset();
    isEmailVerifiedMock.mockReset();
    checkRateLimitMock.mockReset().mockReturnValue({ allowed: true });
    vi.mocked(compareSync).mockReset();
  });

  it('returns 200 + {ok:true} on valid credentials with verified email', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(STORED_USER);
    vi.mocked(compareSync).mockReturnValueOnce(true);
    isEmailVerifiedMock.mockResolvedValueOnce(true);

    const res = await POST(buildRequest(VALID), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 200 + {ok:true} for users with no email (LOGGER role)', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce({ ...STORED_USER, email: null });
    vi.mocked(compareSync).mockReturnValueOnce(true);

    const res = await POST(buildRequest(VALID), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(isEmailVerifiedMock).not.toHaveBeenCalled();
  });

  it('returns 200 + {ok:false, reason:"missing_input"} when identifier missing', async () => {
    const res = await POST(buildRequest({ password: 'x' }), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      reason: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    });
    expect(getUserByIdentifierMock).not.toHaveBeenCalled();
  });

  it('returns 200 + {ok:false, reason:"missing_input"} when password missing', async () => {
    const res = await POST(buildRequest({ identifier: 'x' }), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      reason: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    });
  });

  it('returns 200 + {ok:false, reason:"invalid_credentials"} when user does not exist', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(null);
    const res = await POST(buildRequest(VALID), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      reason: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    });
  });

  it('returns 200 + {ok:false, reason:"invalid_credentials"} on wrong password', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(STORED_USER);
    vi.mocked(compareSync).mockReturnValueOnce(false);
    const res = await POST(buildRequest(VALID), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      reason: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    });
  });

  it('returns 200 + {ok:false, reason:"rate_limited"} when rate limited', async () => {
    checkRateLimitMock.mockReturnValueOnce({ allowed: false, retryAfterMs: 30_000 });
    const res = await POST(buildRequest(VALID), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      reason: AUTH_ERROR_CODES.RATE_LIMITED,
    });
    expect(getUserByIdentifierMock).not.toHaveBeenCalled();
  });

  it('returns 200 + {ok:false, reason:"email_not_verified"} when email unverified', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(STORED_USER);
    vi.mocked(compareSync).mockReturnValueOnce(true);
    isEmailVerifiedMock.mockResolvedValueOnce(false);
    const res = await POST(buildRequest(VALID), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      reason: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
    });
  });

  it('returns 500 when meta-db env vars are missing (server misconfig is a real server error)', async () => {
    getUserByIdentifierMock.mockRejectedValueOnce(
      new Error('META_TURSO_URL and META_TURSO_AUTH_TOKEN must be set in environment variables.'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(buildRequest(VALID), CTX);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      reason: AUTH_ERROR_CODES.SERVER_MISCONFIGURED,
    });
    spy.mockRestore();
  });

  it('returns 500 when DB driver throws a connection error', async () => {
    getUserByIdentifierMock.mockRejectedValueOnce(
      new Error('WebSocket connection failed: ECONNREFUSED'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(buildRequest(VALID), CTX);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      reason: AUTH_ERROR_CODES.DB_UNAVAILABLE,
    });
    spy.mockRestore();
  });

  it('returns 200 + invalid_credentials when body is malformed JSON', async () => {
    const res = await POST(buildRequest('{not json'), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      reason: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    });
  });

  it('keys the rate limiter on the identifier', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(null);
    await POST(buildRequest(VALID), CTX);
    const [key, max, windowMs] = checkRateLimitMock.mock.calls[0] as [string, number, number];
    expect(key).toBe(`login:${VALID.identifier}`);
    expect(max).toBe(10);
    expect(windowMs).toBe(60_000);
  });
});
