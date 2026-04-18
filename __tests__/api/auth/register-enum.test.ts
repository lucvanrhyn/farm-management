import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock deps before importing the route ───────────────────────────────────
const getUserByEmailMock = vi.fn();
const provisionFarmMock = vi.fn();
const checkRateLimitMock = vi.fn();

vi.mock('@/lib/meta-db', () => ({
  getUserByEmail: (...args: unknown[]) => getUserByEmailMock(...args),
}));
vi.mock('../../../../lib/meta-db', () => ({
  getUserByEmail: (...args: unknown[]) => getUserByEmailMock(...args),
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

function buildRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  });
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
    provisionFarmMock.mockReset();
    checkRateLimitMock.mockReset().mockReturnValue({ allowed: true });
  });

  it('returns 200 with {success:true, pending:true} for a NEW email', async () => {
    getUserByEmailMock.mockResolvedValueOnce(null);
    provisionFarmMock.mockResolvedValueOnce({ slug: 'rietfontein-boerdery' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildRequest(VALID_BODY) as any);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildRequest(VALID_BODY) as any);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newRes = await POST(buildRequest(VALID_BODY) as any);
    const newText = await newRes.text();

    // EXISTING
    getUserByEmailMock.mockResolvedValueOnce({
      id: 'u',
      email: VALID_BODY.email,
      username: 'e',
      passwordHash: '$2a$12$h',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingRes = await POST(buildRequest(VALID_BODY) as any);
    const existingText = await existingRes.text();

    expect(newRes.status).toBe(existingRes.status);
    expect(newText).toBe(existingText);
  });

  it('never leaks `slug` in the response (no enumeration signal)', async () => {
    getUserByEmailMock.mockResolvedValueOnce(null);
    provisionFarmMock.mockResolvedValueOnce({ slug: 'secret-slug-do-not-leak' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildRequest(VALID_BODY) as any);
    const body = await res.json();
    expect(body.slug).toBeUndefined();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('secret-slug-do-not-leak');
  });

  // Sanity: validation failures still return distinct errors — enumeration is
  // only about "is this email registered", not "is this email shaped correctly".
  it('still returns 400 on invalid email', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(
      buildRequest({ ...VALID_BODY, email: 'not-an-email' }) as any,
    );
    expect(res.status).toBe(400);
  });
});
