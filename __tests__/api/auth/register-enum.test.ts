import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mock deps before importing the route ───────────────────────────────────
const getUserByEmailMock = vi.fn();
const getUserByUsernameMock = vi.fn();
const provisionFarmMock = vi.fn();
const checkRateLimitMock = vi.fn();

vi.mock('@/lib/meta-db', () => ({
  getUserByEmail: (...args: unknown[]) => getUserByEmailMock(...args),
  getUserByUsername: (...args: unknown[]) => getUserByUsernameMock(...args),
}));
vi.mock('../../../../lib/meta-db', () => ({
  getUserByEmail: (...args: unknown[]) => getUserByEmailMock(...args),
  getUserByUsername: (...args: unknown[]) => getUserByUsernameMock(...args),
}));
vi.mock('@/lib/provisioning', () => ({
  provisionFarm: (...args: unknown[]) => provisionFarmMock(...args),
}));
vi.mock('../../../../lib/provisioning', () => ({
  provisionFarm: (...args: unknown[]) => provisionFarmMock(...args),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));
vi.mock('../../../../lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));
// bcrypt is slow — stub hash to a deterministic constant so tests are fast and
// timing-stable.
vi.mock('bcryptjs', () => ({
  hash: vi.fn().mockResolvedValue('$2a$12$mockhash'),
}));

const { POST } = await import('@/app/api/auth/register/route');

// Wave H2 (#174) — POST is now wrapped in `publicHandler`, so its signature
// is `(req, ctx)`. The adapter tolerates an empty params context (no dynamic
// segments) — every test below passes this `CTX` to satisfy the type.
const CTX = { params: Promise.resolve({}) };

function buildRequest(body: Record<string, unknown>): NextRequest {
  // The route only touches `headers`, `json()`, and `.headers.get()` on the
  // request, so a standard Request is structurally compatible with NextRequest
  // for these tests. Cast here (once, at construction) so call sites don't
  // need per-line eslint disables.
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const VALID_BODY = {
  name: 'Jan van der Merwe',
  email: 'jan@example.com',
  username: 'janvdm',
  password: 'correct-horse-battery-staple',
  farmName: 'Rietfontein Boerdery',
};

describe('POST /api/auth/register — anti-enumeration', () => {
  beforeEach(() => {
    getUserByEmailMock.mockReset();
    // Username is checked BEFORE email; default to "no collision" so the
    // email-anti-enumeration assertions exercise the existing-email branch.
    getUserByUsernameMock.mockReset().mockResolvedValue(null);
    provisionFarmMock.mockReset();
    checkRateLimitMock.mockReset().mockReturnValue({ allowed: true });
  });

  it('returns 200 with {success:true, pending:true} for a NEW email', async () => {
    getUserByEmailMock.mockResolvedValueOnce(null);
    provisionFarmMock.mockResolvedValueOnce({ slug: 'rietfontein-boerdery' });

    const res = await POST(buildRequest(VALID_BODY), CTX);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, pending: true });
  });

  it('returns 200 with {success:true, pending:true} for an EXISTING email', async () => {
    getUserByEmailMock.mockResolvedValueOnce({
      id: 'user-existing',
      email: VALID_BODY.email,
      username: 'existing',
      passwordHash: '$2a$12$existinghash',
    });

    const res = await POST(buildRequest(VALID_BODY), CTX);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, pending: true });
    // MUST NOT provision a farm for an existing email.
    expect(provisionFarmMock).not.toHaveBeenCalled();
  });

  it('responses for new vs existing emails are byte-identical', async () => {
    // NEW
    getUserByEmailMock.mockResolvedValueOnce(null);
    provisionFarmMock.mockResolvedValueOnce({ slug: 'x' });
    const newRes = await POST(buildRequest(VALID_BODY), CTX);
    const newText = await newRes.text();

    // EXISTING
    getUserByEmailMock.mockResolvedValueOnce({
      id: 'u',
      email: VALID_BODY.email,
      username: 'e',
      passwordHash: '$2a$12$h',
    });
    const existingRes = await POST(buildRequest(VALID_BODY), CTX);
    const existingText = await existingRes.text();

    expect(newRes.status).toBe(existingRes.status);
    expect(newText).toBe(existingText);
  });

  it('never leaks `slug` in the response (no enumeration signal)', async () => {
    getUserByEmailMock.mockResolvedValueOnce(null);
    provisionFarmMock.mockResolvedValueOnce({ slug: 'secret-slug-do-not-leak' });

    const res = await POST(buildRequest(VALID_BODY), CTX);
    const body = await res.json();
    expect(body.slug).toBeUndefined();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('secret-slug-do-not-leak');
  });

  // Sanity: validation failures still return distinct errors — enumeration is
  // only about "is this email registered", not "is this email shaped correctly".
  it('still returns 400 on invalid email', async () => {
    const res = await POST(buildRequest({ ...VALID_BODY, email: 'not-an-email' }), CTX);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/register — username collision (H7)', () => {
  beforeEach(() => {
    getUserByEmailMock.mockReset().mockResolvedValue(null);
    getUserByUsernameMock.mockReset().mockResolvedValue(null);
    provisionFarmMock.mockReset();
    checkRateLimitMock.mockReset().mockReturnValue({ allowed: true });
  });

  it('returns 409 for a taken username and does NOT provision', async () => {
    getUserByUsernameMock.mockResolvedValueOnce({
      id: 'user-existing',
      email: 'someone-else@example.com',
      username: VALID_BODY.username,
      passwordHash: '$2a$12$existinghash',
    });

    const res = await POST(buildRequest(VALID_BODY), CTX);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    // No farm/DB is provisioned for a colliding username — this is the H7 fix:
    // the orphan happened precisely because provisioning ran past the collision.
    expect(provisionFarmMock).not.toHaveBeenCalled();
  });

  it('checks username BEFORE email — a colliding username never reaches the email branch', async () => {
    getUserByUsernameMock.mockResolvedValueOnce({
      id: 'u',
      email: 'x@example.com',
      username: VALID_BODY.username,
      passwordHash: '$2a$12$h',
    });

    const res = await POST(buildRequest(VALID_BODY), CTX);
    expect(res.status).toBe(409);
    // Username collision short-circuits before the email lookup.
    expect(getUserByEmailMock).not.toHaveBeenCalled();
  });

  it('proceeds to provision when both username and email are free', async () => {
    getUserByUsernameMock.mockResolvedValueOnce(null);
    getUserByEmailMock.mockResolvedValueOnce(null);
    provisionFarmMock.mockResolvedValueOnce({ slug: 's', userId: 'u' });

    const res = await POST(buildRequest(VALID_BODY), CTX);
    expect(res.status).toBe(200);
    expect(provisionFarmMock).toHaveBeenCalledTimes(1);
  });
});
