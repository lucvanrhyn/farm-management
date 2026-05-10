import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock bcryptjs (declared before auth-options import) ─────────────────────
vi.mock('bcryptjs', () => ({ compareSync: vi.fn() }));

// ─── Mock meta-db ────────────────────────────────────────────────────────────
// The production authorize() calls getUserByIdentifier / isEmailVerified /
// getFarmsForUser — stub them so each test can drive a specific code path.
const getUserByIdentifierMock = vi.fn();
const isEmailVerifiedMock = vi.fn();
const getFarmsForUserMock = vi.fn();
vi.mock('@/lib/meta-db', () => ({
  getUserByIdentifier: (...args: unknown[]) => getUserByIdentifierMock(...args),
  isEmailVerified: (...args: unknown[]) => isEmailVerifiedMock(...args),
  getFarmsForUser: (...args: unknown[]) => getFarmsForUserMock(...args),
}));

// ─── Mock rate-limit ─────────────────────────────────────────────────────────
const checkRateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));

// Import AFTER mocks are registered.
import { compareSync } from 'bcryptjs';
const { authOptions, AUTH_ERROR_CODES } = await import('@/lib/auth-options');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authorize = (authOptions.providers[0] as any).options.authorize as (
  credentials: Record<string, string> | undefined,
) => Promise<unknown>;

// Always-allow rate limiter by default; individual tests override.
const allow = { allowed: true as const };
const deny = { allowed: false as const, retryAfterMs: 60_000 };

const VALID_CREDENTIALS = {
  identifier: 'field@example.com',
  password: '<<seed-from-env>>',
};

const STORED_USER = {
  id: 'user-1',
  email: 'field@example.com',
  username: 'dicky',
  passwordHash: '$2a$12$hashedpassword',
  name: 'Dicky',
};

describe('authorize (auth-options.ts)', () => {
  beforeEach(() => {
    getUserByIdentifierMock.mockReset();
    isEmailVerifiedMock.mockReset();
    getFarmsForUserMock.mockReset();
    checkRateLimitMock.mockReset().mockReturnValue(allow);
    vi.mocked(compareSync).mockReset();
  });

  // ── Happy path ────────────────────────────────────────────────────────────
  it('returns the user when credentials + email verification pass', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(STORED_USER);
    vi.mocked(compareSync).mockReturnValueOnce(true);
    isEmailVerifiedMock.mockResolvedValueOnce(true);
    getFarmsForUserMock.mockResolvedValueOnce([
      { slug: 'trio-b', displayName: 'Trio B', role: 'ADMIN', logoUrl: null, tier: 'advanced', subscriptionStatus: 'active' },
    ]);

    const result = await authorize(VALID_CREDENTIALS);

    expect(result).toMatchObject({
      id: 'user-1',
      email: 'field@example.com',
      username: 'dicky',
      role: 'ADMIN',
    });
  });

  // ── Missing credentials ────────────────────────────────────────────────────
  it('throws INVALID_CREDENTIALS when fields are empty', async () => {
    await expect(authorize({ identifier: '', password: '' })).rejects.toThrow(
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    );
    expect(getUserByIdentifierMock).not.toHaveBeenCalled();
  });

  it('throws INVALID_CREDENTIALS when credentials is undefined', async () => {
    await expect(authorize(undefined)).rejects.toThrow(
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    );
  });

  // ── Rate limited ───────────────────────────────────────────────────────────
  it('throws RATE_LIMITED when the rate-limit is exceeded', async () => {
    checkRateLimitMock.mockReturnValueOnce(deny);
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.RATE_LIMITED,
    );
    expect(getUserByIdentifierMock).not.toHaveBeenCalled();
  });

  // ── Server misconfigured (env vars missing) ─────────────────────────────────
  it('throws SERVER_MISCONFIGURED when meta-db env vars are missing', async () => {
    getUserByIdentifierMock.mockRejectedValueOnce(
      new Error(
        'META_TURSO_URL and META_TURSO_AUTH_TOKEN must be set in environment variables.',
      ),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.SERVER_MISCONFIGURED,
    );
    spy.mockRestore();
  });

  // ── DB unavailable ─────────────────────────────────────────────────────────
  it('throws DB_UNAVAILABLE when the DB driver throws a non-env error', async () => {
    const dbError = new Error(
      'WebSocket connection failed: ECONNREFUSED',
    );
    getUserByIdentifierMock.mockRejectedValueOnce(dbError);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.DB_UNAVAILABLE,
    );
    // Wave 4 G.4: lib/auth-options now logs through @/lib/logger which emits
    // `console.error(message, { message, stack })` in dev. We assert the
    // prefix is in the message and the underlying error message + stack
    // are surfaced through the structured payload.
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[authorize]'),
      expect.objectContaining({
        message: expect.stringContaining('WebSocket connection failed: ECONNREFUSED'),
        stack: expect.any(String),
      }),
    );
    spy.mockRestore();
  });

  // ── User not found ─────────────────────────────────────────────────────────
  it('throws INVALID_CREDENTIALS (generic) when user does not exist', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(null);
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    );
  });

  // ── Wrong password ─────────────────────────────────────────────────────────
  it('throws INVALID_CREDENTIALS (generic) when password is wrong', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(STORED_USER);
    vi.mocked(compareSync).mockReturnValueOnce(false);
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    );
  });

  // ── Email not verified ─────────────────────────────────────────────────────
  it('throws EMAIL_NOT_VERIFIED when the user exists but email is unverified', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(STORED_USER);
    vi.mocked(compareSync).mockReturnValueOnce(true);
    isEmailVerifiedMock.mockResolvedValueOnce(false);
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
    );
  });

  // ── Users without email (e.g. LOGGER role) skip verification ────────────────
  it('does NOT check email verification when user has no email', async () => {
    const userNoEmail = { ...STORED_USER, email: null };
    getUserByIdentifierMock.mockResolvedValueOnce(userNoEmail);
    vi.mocked(compareSync).mockReturnValueOnce(true);
    getFarmsForUserMock.mockResolvedValueOnce([]);

    const result = await authorize(VALID_CREDENTIALS);

    expect(isEmailVerifiedMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'user-1', email: null });
  });

  // ── Email verification check fails (DB throw on second query) ──────────────
  it('throws DB_UNAVAILABLE when email verification query throws', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(STORED_USER);
    vi.mocked(compareSync).mockReturnValueOnce(true);
    isEmailVerifiedMock.mockRejectedValueOnce(
      new Error('meta-db connection dropped'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.DB_UNAVAILABLE,
    );
    spy.mockRestore();
  });

  // ── Rate-limit key uses the identifier ─────────────────────────────────────
  it('keys the rate limiter on the identifier', async () => {
    getUserByIdentifierMock.mockResolvedValueOnce(null);
    await authorize(VALID_CREDENTIALS).catch(() => {});
    const [key, max, windowMs] = checkRateLimitMock.mock.calls[0] as [
      string,
      number,
      number,
    ];
    expect(key).toBe(`login:${VALID_CREDENTIALS.identifier}`);
    expect(max).toBe(10);
    expect(windowMs).toBe(60_000);
  });
});
