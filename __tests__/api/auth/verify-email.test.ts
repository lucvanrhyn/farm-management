import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks (declared before route import) ──────────────────────────────────────
const verifyUserEmailMock = vi.fn();
vi.mock('@/lib/meta-db', () => ({
  verifyUserEmail: (...args: unknown[]) => verifyUserEmailMock(...args),
}));

// Import AFTER mocks are registered.
const { GET } = await import('@/app/api/auth/verify-email/route');

// Wave H2 (#174) — GET is now wrapped in `publicHandler`, so its signature
// is `(req, ctx)`. The adapter tolerates an empty params context (no dynamic
// segments) — every test below passes this `CTX` to satisfy the type.
const CTX = { params: Promise.resolve({}) };

function makeReq(token?: string): NextRequest {
  const url = token
    ? `https://example.com/api/auth/verify-email?token=${encodeURIComponent(token)}`
    : 'https://example.com/api/auth/verify-email';
  // The route only touches `request.url`, so a standard Request is structurally
  // compatible with NextRequest for these tests. Cast here (once, at
  // construction) so call sites don't need per-line eslint disables.
  return new Request(url, { method: 'GET' }) as unknown as NextRequest;
}

describe('GET /api/auth/verify-email', () => {
  beforeEach(() => {
    verifyUserEmailMock.mockReset();
  });

  // ── Happy path — valid token ─────────────────────────────────────────────────
  it('returns 200 { valid: true } when the token is valid', async () => {
    verifyUserEmailMock.mockResolvedValueOnce({ userId: 'user-abc' });

    const res = await GET(makeReq('good-token-123'), CTX);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ valid: true });
  });

  // ── Missing token ────────────────────────────────────────────────────────────
  it('returns 200 { valid: false, reason: "missing_token" } when no token is provided', async () => {
    const res = await GET(makeReq(), CTX);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ valid: false, reason: 'missing_token' });
    // verifyUserEmail must not be called when the token is absent
    expect(verifyUserEmailMock).not.toHaveBeenCalled();
  });

  // ── Invalid / bogus token ────────────────────────────────────────────────────
  it('returns 200 { valid: false, reason: "invalid_token" } when the token does not match any row', async () => {
    verifyUserEmailMock.mockResolvedValueOnce(null);

    const res = await GET(makeReq('bogus-token-xyz'), CTX);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ valid: false, reason: 'invalid_token' });
  });

  // ── Expired token ────────────────────────────────────────────────────────────
  // verifyUserEmail returns null for both "no row found" and "expired" (DB
  // filters by verification_expires > now). We expose the distinction via a
  // separate reason code so the client can show a tailored UI in future; for
  // now the DB helper collapses both into null, so both cases map to
  // "invalid_token". This test ensures that behaviour is stable.
  it('returns 200 { valid: false, reason: "invalid_token" } when the token has expired', async () => {
    verifyUserEmailMock.mockResolvedValueOnce(null);

    const res = await GET(makeReq('expired-token-abc'), CTX);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ valid: false, reason: 'invalid_token' });
  });

  // ── No 4xx on any error path ─────────────────────────────────────────────────
  it('never returns a 4xx status (so the browser never logs a network error)', async () => {
    verifyUserEmailMock.mockResolvedValueOnce(null);

    const missingRes = await GET(makeReq(), CTX);
    const invalidRes = await GET(makeReq('bad'), CTX);

    expect(missingRes.status).not.toBeGreaterThanOrEqual(400);
    expect(invalidRes.status).not.toBeGreaterThanOrEqual(400);
  });

  // ── DB error ─────────────────────────────────────────────────────────────────
  it('returns 500 on unexpected DB failure and logs via logger', async () => {
    verifyUserEmailMock.mockRejectedValueOnce(new Error('meta-db offline'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await GET(makeReq('any-token'), CTX);

    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[verify-email]'),
      expect.objectContaining({
        message: expect.stringContaining('meta-db offline'),
        stack: expect.any(String),
      }),
    );
    spy.mockRestore();
  });
});
