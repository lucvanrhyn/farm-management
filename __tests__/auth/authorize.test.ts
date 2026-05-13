import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock bcryptjs (declared before auth-options import) ─────────────────────
vi.mock('bcryptjs', () => ({ compareSync: vi.fn() }));

// ─── Mock meta-db ────────────────────────────────────────────────────────────
// Wave 6b (#261): authorize() now calls `findUserByIdentifier` (typed
// result), not the deprecated `getUserByIdentifier`. Tests mock the new
// surface and re-export the lookup-error vocabulary so individual specs
// can drive the AMBIGUOUS / NOT_FOUND branches.
const findUserByIdentifierMock = vi.fn();
const isEmailVerifiedMock = vi.fn();
const getFarmsForUserMock = vi.fn();
const AUTH_LOOKUP_ERROR_FIXTURE = {
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS: 'AMBIGUOUS',
} as const;
vi.mock('@/lib/meta-db', () => ({
  findUserByIdentifier: (...args: unknown[]) => findUserByIdentifierMock(...args),
  isEmailVerified: (...args: unknown[]) => isEmailVerifiedMock(...args),
  getFarmsForUser: (...args: unknown[]) => getFarmsForUserMock(...args),
  AUTH_LOOKUP_ERROR: AUTH_LOOKUP_ERROR_FIXTURE,
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

// Wave 6b (#261): identifier is USERNAME ONLY. The legacy email shape is
// kept on the stored user record (email is still a valid attribute used
// for verification flows) but it's never accepted as a sign-in identifier.
const VALID_CREDENTIALS = {
  identifier: 'dicky',
  password: '<<seed-from-env>>',
};

const STORED_USER = {
  id: 'user-1',
  email: 'field@example.com',
  username: 'dicky',
  passwordHash: '$2a$12$hashedpassword',
  name: 'Dicky',
};

// Helper for the typed `findUserByIdentifier` shape (Wave 6b / #261).
const lookupHit = (user: typeof STORED_USER) =>
  ({ ok: true as const, user });
const lookupMiss = () =>
  ({ ok: false as const, code: AUTH_LOOKUP_ERROR_FIXTURE.NOT_FOUND });
const lookupAmbiguous = () =>
  ({ ok: false as const, code: AUTH_LOOKUP_ERROR_FIXTURE.AMBIGUOUS });

describe('authorize (auth-options.ts)', () => {
  beforeEach(() => {
    findUserByIdentifierMock.mockReset();
    isEmailVerifiedMock.mockReset();
    getFarmsForUserMock.mockReset();
    checkRateLimitMock.mockReset().mockReturnValue(allow);
    vi.mocked(compareSync).mockReset();
  });

  // ── Happy path ────────────────────────────────────────────────────────────
  it('returns the user when credentials + email verification pass', async () => {
    findUserByIdentifierMock.mockResolvedValueOnce(lookupHit(STORED_USER));
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
    expect(findUserByIdentifierMock).not.toHaveBeenCalled();
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
    expect(findUserByIdentifierMock).not.toHaveBeenCalled();
  });

  // ── Server misconfigured (env vars missing) ─────────────────────────────────
  it('throws SERVER_MISCONFIGURED when meta-db env vars are missing', async () => {
    findUserByIdentifierMock.mockRejectedValueOnce(
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
    findUserByIdentifierMock.mockRejectedValueOnce(dbError);
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
    findUserByIdentifierMock.mockResolvedValueOnce(lookupMiss());
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    );
  });

  // ── Ambiguous lookup (legacy meta-DB without unique constraint) ────────────
  it('throws SERVER_MISCONFIGURED when findUserByIdentifier returns AMBIGUOUS', async () => {
    findUserByIdentifierMock.mockResolvedValueOnce(lookupAmbiguous());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.SERVER_MISCONFIGURED,
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[authorize] ambiguous username'),
      expect.objectContaining({ identifier: 'dicky' }),
    );
    spy.mockRestore();
  });

  // ── Wrong password ─────────────────────────────────────────────────────────
  it('throws INVALID_CREDENTIALS (generic) when password is wrong', async () => {
    findUserByIdentifierMock.mockResolvedValueOnce(lookupHit(STORED_USER));
    vi.mocked(compareSync).mockReturnValueOnce(false);
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    );
  });

  // ── Email not verified ─────────────────────────────────────────────────────
  it('throws EMAIL_NOT_VERIFIED when the user exists but email is unverified', async () => {
    findUserByIdentifierMock.mockResolvedValueOnce(lookupHit(STORED_USER));
    vi.mocked(compareSync).mockReturnValueOnce(true);
    isEmailVerifiedMock.mockResolvedValueOnce(false);
    await expect(authorize(VALID_CREDENTIALS)).rejects.toThrow(
      AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
    );
  });

  // ── Users without email (e.g. LOGGER role) skip verification ────────────────
  it('does NOT check email verification when user has no email', async () => {
    const userNoEmail = { ...STORED_USER, email: null };
    findUserByIdentifierMock.mockResolvedValueOnce(
      lookupHit(userNoEmail as unknown as typeof STORED_USER),
    );
    vi.mocked(compareSync).mockReturnValueOnce(true);
    getFarmsForUserMock.mockResolvedValueOnce([]);

    const result = await authorize(VALID_CREDENTIALS);

    expect(isEmailVerifiedMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'user-1', email: null });
  });

  // ── Email verification check fails (DB throw on second query) ──────────────
  it('throws DB_UNAVAILABLE when email verification query throws', async () => {
    findUserByIdentifierMock.mockResolvedValueOnce(lookupHit(STORED_USER));
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
    findUserByIdentifierMock.mockResolvedValueOnce(lookupMiss());
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
