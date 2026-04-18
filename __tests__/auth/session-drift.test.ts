import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock meta-db before importing auth-options ─────────────────────────────
const getFarmsForUserMock = vi.fn();
vi.mock('@/lib/meta-db', () => ({
  getUserByIdentifier: vi.fn(),
  isEmailVerified: vi.fn(),
  getFarmsForUser: (...args: unknown[]) => getFarmsForUserMock(...args),
}));
vi.mock('bcryptjs', () => ({ compareSync: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockReturnValue({ allowed: true }) }));

const { authOptions, SESSION_ROLE_TTL_MS } = await import('@/lib/auth-options');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jwtCb = authOptions.callbacks!.jwt as (args: any) => Promise<any>;

/**
 * A1 regression guard — session role-drift window.
 *
 * The JWT refreshes the user's farms/role from meta-db every
 * SESSION_ROLE_TTL_MS. Dropping this from 5 min → 60 s shortens the window
 * during which a revoked ADMIN can still act as ADMIN. Destructive ops
 * additionally call verifyFreshAdminRole() to bypass the JWT entirely.
 */
describe('session role-drift TTL', () => {
  beforeEach(() => {
    getFarmsForUserMock.mockReset();
  });

  it('exports SESSION_ROLE_TTL_MS = 60_000 (60 s, not 5 min)', () => {
    expect(SESSION_ROLE_TTL_MS).toBe(60_000);
  });

  it('skips farm refresh when token is younger than the TTL', async () => {
    const token = {
      sub: 'user-1',
      role: 'ADMIN',
      farms: [{ slug: 'trio-b', role: 'ADMIN' }],
      // refreshed 10 seconds ago — well under 60 s
      farmsRefreshedAt: Date.now() - 10_000,
    };

    await jwtCb({ token, user: undefined, trigger: undefined });

    expect(getFarmsForUserMock).not.toHaveBeenCalled();
  });

  it('refreshes farms when the token is older than the TTL', async () => {
    const token = {
      sub: 'user-1',
      role: 'ADMIN',
      farms: [{ slug: 'trio-b', role: 'ADMIN' }],
      // refreshed 61 s ago — past the new 60 s window
      farmsRefreshedAt: Date.now() - 61_000,
    };
    getFarmsForUserMock.mockResolvedValueOnce([
      { slug: 'trio-b', role: 'DASHBOARD' },
    ]);

    const out = await jwtCb({ token, user: undefined, trigger: undefined });

    expect(getFarmsForUserMock).toHaveBeenCalledWith('user-1');
    expect(out.role).toBe('DASHBOARD');
  });

  it('refreshes farms on explicit trigger="update" regardless of age', async () => {
    const token = {
      sub: 'user-1',
      role: 'ADMIN',
      farms: [],
      farmsRefreshedAt: Date.now(), // fresh
    };
    getFarmsForUserMock.mockResolvedValueOnce([
      { slug: 'trio-b', role: 'LOGGER' },
    ]);

    const out = await jwtCb({ token, user: undefined, trigger: 'update' });

    expect(getFarmsForUserMock).toHaveBeenCalledTimes(1);
    expect(out.role).toBe('LOGGER');
  });
});
