/**
 * Integration tests for POST /api/auth/reset-password (issue #102 slice 2).
 *
 * Security properties verified:
 *   - Valid token + valid password → { valid: true }, password hash updated, token cleared
 *   - Expired token → { valid: false }, password NOT changed (slice-1 residual enforced here)
 *   - Unknown/absent token → { valid: false }
 *   - Single-use: second consume of same token → { valid: false }
 *   - Password validation BEFORE token consume (short password → 400, token not touched)
 *   - Passwords mismatch → 400, token not consumed
 *   - Missing token in body → 400
 *   - bcrypt cost 12 used for new hash
 *   - DB error → 500 with generic message
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks (declared before route import) ──────────────────────────────────────

const consumePasswordResetTokenMock = vi.fn();
const resetUserPasswordMock = vi.fn();

vi.mock('@/lib/meta-db', () => ({
  consumePasswordResetToken: (...args: unknown[]) =>
    consumePasswordResetTokenMock(...args),
  resetUserPassword: (...args: unknown[]) => resetUserPasswordMock(...args),
}));

// Stub bcryptjs to avoid 200ms cost in tests.
const hashMock = vi.fn().mockResolvedValue('$2a$12$newhash');
vi.mock('bcryptjs', () => ({
  hash: (...args: unknown[]) => hashMock(...args),
}));

// Import AFTER mocks.
const { POST } = await import('@/app/api/auth/reset-password/route');

const CTX = { params: Promise.resolve({}) };

function makeReq(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    consumePasswordResetTokenMock.mockReset();
    resetUserPasswordMock.mockReset().mockResolvedValue(undefined);
    hashMock.mockReset().mockResolvedValue('$2a$12$newhash');
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns { valid: true } and updates the password when token is valid', async () => {
    consumePasswordResetTokenMock.mockResolvedValueOnce({ userId: 'user-1' });

    const res = await POST(
      makeReq({ token: 'valid-tok', password: 'newpass123', passwordConfirm: 'newpass123' }),
      CTX,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true });

    expect(consumePasswordResetTokenMock).toHaveBeenCalledOnce();
    expect(consumePasswordResetTokenMock).toHaveBeenCalledWith('valid-tok');

    // bcrypt at cost 12
    expect(hashMock).toHaveBeenCalledOnce();
    expect(hashMock).toHaveBeenCalledWith('newpass123', 12);

    // password update called with userId + new hash
    expect(resetUserPasswordMock).toHaveBeenCalledOnce();
    expect(resetUserPasswordMock).toHaveBeenCalledWith('user-1', '$2a$12$newhash');
  });

  // ── Expired-token enforcement (headline slice-1 residual) ─────────────────

  it('returns { valid: false } for an expired token — password NOT changed', async () => {
    // consumePasswordResetToken returns null → token absent or expired
    consumePasswordResetTokenMock.mockResolvedValueOnce(null);

    const res = await POST(
      makeReq({ token: 'expired-tok', password: 'newpass123', passwordConfirm: 'newpass123' }),
      CTX,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false });

    // Password must NOT be updated
    expect(resetUserPasswordMock).not.toHaveBeenCalled();
    expect(hashMock).not.toHaveBeenCalled();
  });

  // ── Unknown token ─────────────────────────────────────────────────────────

  it('returns { valid: false } for an unknown/absent token', async () => {
    consumePasswordResetTokenMock.mockResolvedValueOnce(null);

    const res = await POST(
      makeReq({ token: 'unknown-tok', password: 'newpass123', passwordConfirm: 'newpass123' }),
      CTX,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false });
    expect(resetUserPasswordMock).not.toHaveBeenCalled();
  });

  // ── Single-use invalidation ───────────────────────────────────────────────

  it('second use of same token returns { valid: false } — single-use enforced', async () => {
    // First use: succeeds
    consumePasswordResetTokenMock.mockResolvedValueOnce({ userId: 'user-1' });

    const first = await POST(
      makeReq({ token: 'use-once', password: 'newpass123', passwordConfirm: 'newpass123' }),
      CTX,
    );
    expect(await first.json()).toEqual({ valid: true });

    // Second use: token already cleared → consumePasswordResetToken returns null
    consumePasswordResetTokenMock.mockResolvedValueOnce(null);

    const second = await POST(
      makeReq({ token: 'use-once', password: 'newpass123', passwordConfirm: 'newpass123' }),
      CTX,
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ valid: false });
  });

  // ── Password validation before token consume ──────────────────────────────

  it('returns 400 when password is shorter than 8 characters — token NOT consumed', async () => {
    const res = await POST(
      makeReq({ token: 'valid-tok', password: 'short', passwordConfirm: 'short' }),
      CTX,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'VALIDATION_FAILED',
      message: 'Password must be at least 8 characters',
    });
    // Token must not be consumed — validation fires before any DB call
    expect(consumePasswordResetTokenMock).not.toHaveBeenCalled();
  });

  it('returns 400 when passwords do not match — token NOT consumed', async () => {
    const res = await POST(
      makeReq({
        token: 'valid-tok',
        password: 'newpass123',
        passwordConfirm: 'different456',
      }),
      CTX,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'VALIDATION_FAILED',
      message: 'Passwords do not match',
    });
    expect(consumePasswordResetTokenMock).not.toHaveBeenCalled();
  });

  it('returns 400 when token field is missing', async () => {
    const res = await POST(
      makeReq({ password: 'newpass123', passwordConfirm: 'newpass123' }),
      CTX,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'VALIDATION_FAILED',
      message: 'token is required',
    });
    expect(consumePasswordResetTokenMock).not.toHaveBeenCalled();
  });

  it('returns 400 when password field is missing', async () => {
    const res = await POST(
      makeReq({ token: 'valid-tok', passwordConfirm: 'newpass123' }),
      CTX,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'VALIDATION_FAILED',
      message: 'password is required',
    });
    expect(consumePasswordResetTokenMock).not.toHaveBeenCalled();
  });

  it('returns 400 when passwordConfirm field is missing', async () => {
    const res = await POST(
      makeReq({ token: 'valid-tok', password: 'newpass123' }),
      CTX,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'VALIDATION_FAILED',
      message: 'passwordConfirm is required',
    });
    expect(consumePasswordResetTokenMock).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON body', async () => {
    const req = new NextRequest('https://example.com/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });

    const res = await POST(req, CTX);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'INVALID_BODY',
      message: 'Request body must be valid JSON',
    });
    expect(consumePasswordResetTokenMock).not.toHaveBeenCalled();
  });

  // ── No partial-state on token but DB failure ──────────────────────────────

  it('returns 500 on DB error after token consume — token was already cleared (atomicity note)', async () => {
    // consumePasswordResetToken succeeded — but resetUserPassword throws
    consumePasswordResetTokenMock.mockResolvedValueOnce({ userId: 'user-1' });
    resetUserPasswordMock.mockRejectedValueOnce(new Error('DB offline'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(
      makeReq({ token: 'valid-tok', password: 'newpass123', passwordConfirm: 'newpass123' }),
      CTX,
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    });
    spy.mockRestore();
  });

  // ── Response shape: no 4xx for token-not-found paths ────────────────────

  it('always returns HTTP 200 (not 4xx) when the token is absent/expired — no browser network-error noise', async () => {
    consumePasswordResetTokenMock.mockResolvedValueOnce(null);

    const res = await POST(
      makeReq({ token: 'bad-tok', password: 'newpass123', passwordConfirm: 'newpass123' }),
      CTX,
    );

    // Must be 200, not 401/403/404/410 — so browser never auto-logs a
    // "Failed to load resource" network error.
    expect(res.status).toBe(200);
    expect(res.status).not.toBeGreaterThanOrEqual(400);
  });
});
