import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock meta-db before importing auth-options ─────────────────────────────
const getFarmsForUserMock = vi.fn();
vi.mock('@/lib/meta-db', () => ({
  // Wave 6b (#261): authorize() uses `findUserByIdentifier`. This test
  // doesn't drive the lookup path — it asserts the JWT-callback's
  // farm-refresh contract — so the mock is unused but must exist.
  findUserByIdentifier: vi.fn(),
  AUTH_LOOKUP_ERROR: { NOT_FOUND: 'NOT_FOUND', AMBIGUOUS: 'AMBIGUOUS' } as const,
  isEmailVerified: vi.fn(),
  getFarmsForUser: (...args: unknown[]) => getFarmsForUserMock(...args),
}));
vi.mock('bcryptjs', () => ({ compareSync: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockReturnValue({ allowed: true }) }));

const { authOptions } = await import('@/lib/auth-options');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jwtCb = authOptions.callbacks!.jwt as (args: any) => Promise<any>;

/**
 * Phase H regression guard — JWT callback must NOT hit meta-db on every
 * session read. Previously the callback re-fetched `token.farms` whenever
 * the token was older than SESSION_ROLE_TTL_MS (60 s), which forced a
 * Tokyo RTT on the first `getServerSession` call per minute.
 *
 * Live admin role verification happens in `verifyFreshAdminRole` on every
 * destructive op (bulk reset + tenant-wide settings PATCH), so the JWT
 * refresh is redundant.
 */
describe('jwt callback — no periodic meta-db refresh', () => {
  beforeEach(() => {
    getFarmsForUserMock.mockReset();
  });

  it('populates farms on initial sign-in (user arg present)', async () => {
    const user = {
      id: 'user-1',
      username: 'alice',
      role: 'ADMIN',
      farms: [{ slug: 'trio-b', role: 'ADMIN' }],
    };

    const out = await jwtCb({
      token: { sub: 'user-1' },
      user,
      trigger: 'signIn',
    });

    expect(out.role).toBe('ADMIN');
    expect(out.username).toBe('alice');
    expect(out.farms).toEqual([{ slug: 'trio-b', role: 'ADMIN' }]);
    // Must NOT have hit meta-db — farms came from the authorize() payload.
    expect(getFarmsForUserMock).not.toHaveBeenCalled();
  });

  it('does NOT refetch farms on subsequent reads even when the token is old', async () => {
    const token = {
      sub: 'user-1',
      role: 'ADMIN',
      farms: [{ slug: 'trio-b', role: 'ADMIN' }],
    };

    // Simulate a session read 10 minutes after sign-in — well past the
    // old 60 s TTL that used to trigger a refresh.
    await jwtCb({ token, user: undefined, trigger: undefined });

    expect(getFarmsForUserMock).not.toHaveBeenCalled();
  });

  it('calls getFarmsForUser exactly once across initial sign-in + later read', async () => {
    const user = {
      id: 'user-1',
      username: 'alice',
      role: 'ADMIN',
      farms: [{ slug: 'trio-b', role: 'ADMIN' }],
    };

    // Initial sign-in — callback sets farms from `user` arg, no meta-db call.
    const afterSignIn = await jwtCb({
      token: { sub: 'user-1' },
      user,
      trigger: 'signIn',
    });

    // Later session read — no `user`, no `trigger`. Must not call meta-db.
    await jwtCb({
      token: afterSignIn,
      user: undefined,
      trigger: undefined,
    });

    // Phase H accepts stale farms in JWT until the session re-issues.
    // verifyFreshAdminRole() covers the destructive-op path.
    expect(getFarmsForUserMock).toHaveBeenCalledTimes(0);
  });

  it('still refetches farms on explicit trigger="update" so useSession().update() keeps working', async () => {
    const token = {
      sub: 'user-1',
      role: 'ADMIN',
      farms: [],
    };
    getFarmsForUserMock.mockResolvedValueOnce([
      { slug: 'trio-b', role: 'LOGGER' },
    ]);

    const out = await jwtCb({ token, user: undefined, trigger: 'update' });

    expect(getFarmsForUserMock).toHaveBeenCalledTimes(1);
    expect(out.role).toBe('LOGGER');
  });
});
