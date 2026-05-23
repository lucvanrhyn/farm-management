import { describe, it, expect, vi } from 'vitest';

// Keep the authorize() path importable without hitting real modules.
vi.mock('@/lib/meta-db', () => ({
  // Wave 6b (#261): authorize() uses `findUserByIdentifier` (typed
  // result). This test only inspects `authOptions.session.maxAge`, so
  // the mock returns are never used — the symbol just has to exist.
  findUserByIdentifier: vi.fn(),
  AUTH_LOOKUP_ERROR: { NOT_FOUND: 'NOT_FOUND', AMBIGUOUS: 'AMBIGUOUS' } as const,
  isEmailVerified: vi.fn(),
  getFarmsForUser: vi.fn(),
}));
vi.mock('bcryptjs', () => ({ compareSync: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
}));

const { authOptions } = await import('@/lib/auth-options');

/**
 * Phase H.2 regression guard — bound the stale-ADMIN window.
 *
 * Phase H dropped the 60 s meta-db refresh from the jwt callback, meaning
 * session.user.farms is only re-sourced at sign-in or on explicit
 * useSession().update(). Without an explicit session.maxAge, next-auth v4
 * defaults to 30 days — so a demoted ADMIN keeps their stale role on every
 * route that trusts session.user.farms (i.e. everything NOT wired through
 * verifyFreshAdminRole) for up to 30 d.
 *
 * Setting session.maxAge = 8 hours caps the worst-case staleness at one
 * business day while preserving the Phase H "zero meta-db round-trip on
 * the hot path" win. The 8-hour ceiling combines with verifyFreshAdminRole
 * (defence-in-depth on admin-write routes) to close the gap.
 */
describe('authOptions.session.maxAge — bounds stale-ADMIN window', () => {
  it('is set to 8 hours (next-auth default 30 d is unsafe post-Phase H)', () => {
    expect(authOptions.session).toBeDefined();
    expect(authOptions.session?.maxAge).toBe(60 * 60 * 8);
  });
});
