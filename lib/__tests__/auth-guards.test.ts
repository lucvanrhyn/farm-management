// @vitest-environment node
/**
 * lib/__tests__/auth-guards.test.ts
 *
 * TDD unit tests for the three auth redirect-guards added in #522.
 *
 * Each guard is built on existing primitives in lib/auth.ts:
 *   - requireSession    → calls getSession(), redirects to /login?next=<path>
 *   - requireFarmAdmin  → calls getUserRoleForFarm(), redirects unless ADMIN
 *   - requirePlatformAdmin → calls isPlatformAdmin(), redirects unless admin;
 *                            FAIL-CLOSED: any error/unreachable meta-db → redirect
 *
 * Redirect-test pattern: vi.mock('next/navigation') where redirect() throws
 * `__REDIRECT__:<url>` — same approach as __tests__/app/admin-layout.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from 'next-auth';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
// vi.hoisted() runs before module resolution, so factory-level references work.

const { getServerSessionMock, isPlatformAdminMock, redirectMock } = vi.hoisted(() => {
  return {
    getServerSessionMock: vi.fn(),
    isPlatformAdminMock: vi.fn(),
    redirectMock: vi.fn((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    }),
  };
});

vi.mock('next/navigation', () => ({ redirect: redirectMock }));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

// Mock auth-options (required by getServerSession call in lib/auth.ts)
vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

// Mock getFarmsForUser (imported by lib/auth.ts) and isPlatformAdmin
vi.mock('@/lib/meta-db', () => ({
  getFarmsForUser: vi.fn(),
  isPlatformAdmin: isPlatformAdminMock,
}));

// ── Import the guards under test ───────────────────────────────────────────

import {
  requireSession,
  requireFarmAdmin,
  requirePlatformAdmin,
  getUserRoleForFarm,
} from '@/lib/auth';

// ── Helpers ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Restore redirect throw behaviour after clearAllMocks
  redirectMock.mockImplementation((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  });
});

function makeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-1',
      email: 'farmer@example.com',
      name: 'Farmer',
      farms: [{ slug: 'test-farm', role: 'ADMIN' }],
      ...overrides,
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  } as unknown as Session;
}

function extractRedirectUrl(err: unknown): string {
  if (err instanceof Error && err.message.startsWith('__REDIRECT__:')) {
    return err.message.slice('__REDIRECT__:'.length);
  }
  throw new Error(`Expected a redirect error, got: ${String(err)}`);
}

// ─────────────────────────────────────────────────────────────────────────
// requireSession
// ─────────────────────────────────────────────────────────────────────────

describe('requireSession', () => {
  it('returns the session when the user is authenticated', async () => {
    const session = makeSession();
    getServerSessionMock.mockResolvedValueOnce(session);

    const result = await requireSession('/some/page');
    expect(result).toBe(session);
  });

  it('redirects to /login (no next param) when currentPath is omitted and there is no session', async () => {
    getServerSessionMock.mockResolvedValueOnce(null);

    await expect(requireSession()).rejects.toThrow('__REDIRECT__:');
    const call = redirectMock.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/^\/login/);
  });

  it('redirects to /login?next=<encoded-path> when unauthenticated and currentPath is provided', async () => {
    getServerSessionMock.mockResolvedValueOnce(null);

    let caughtUrl = '';
    try {
      await requireSession('/acme/admin/settings');
    } catch (err) {
      caughtUrl = extractRedirectUrl(err);
    }

    expect(caughtUrl).toBe(`/login?next=${encodeURIComponent('/acme/admin/settings')}`);
  });

  it('encodes paths with query strings correctly', async () => {
    getServerSessionMock.mockResolvedValueOnce(null);

    let caughtUrl = '';
    try {
      await requireSession('/acme/admin/settings?tab=billing');
    } catch (err) {
      caughtUrl = extractRedirectUrl(err);
    }

    expect(caughtUrl).toBe(`/login?next=${encodeURIComponent('/acme/admin/settings?tab=billing')}`);
  });

  it('does NOT redirect when a valid session exists — no redirect call made', async () => {
    getServerSessionMock.mockResolvedValueOnce(makeSession());
    await requireSession('/some/page');
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects to /login (no next param) when currentPath is an unsafe open-redirect URL', async () => {
    // getSafeNext() rejects `//evil.example` — guard should fall back to /login
    getServerSessionMock.mockResolvedValueOnce(null);

    let caughtUrl = '';
    try {
      await requireSession('//evil.example');
    } catch (err) {
      caughtUrl = extractRedirectUrl(err);
    }

    expect(caughtUrl).toBe('/login');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// requireFarmAdmin
// ─────────────────────────────────────────────────────────────────────────

describe('requireFarmAdmin', () => {
  it('resolves (no redirect) when the user has ADMIN role for the farm', async () => {
    const session = makeSession({
      farms: [{ slug: 'acme', role: 'ADMIN' }],
    } as never);

    await expect(requireFarmAdmin(session, 'acme')).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects when the user has LOGGER role for the farm', async () => {
    const session = makeSession({
      farms: [{ slug: 'acme', role: 'LOGGER' }],
    } as never);

    await expect(requireFarmAdmin(session, 'acme')).rejects.toThrow('__REDIRECT__:');
  });

  it('redirects when the user has DASHBOARD role for the farm', async () => {
    const session = makeSession({
      farms: [{ slug: 'acme', role: 'DASHBOARD' }],
    } as never);

    await expect(requireFarmAdmin(session, 'acme')).rejects.toThrow('__REDIRECT__:');
  });

  it('redirects when the user has no role for the farm (null)', async () => {
    const session = makeSession({
      farms: [],
    } as never);

    await expect(requireFarmAdmin(session, 'acme')).rejects.toThrow('__REDIRECT__:');
  });

  it('passes the correct slug to getUserRoleForFarm', async () => {
    // getUserRoleForFarm is a pure function — test that the guard calls it
    // with the right arguments by verifying ADMIN pass on the matching slug.
    const session = makeSession({
      farms: [{ slug: 'my-farm', role: 'ADMIN' }],
    } as never);

    await requireFarmAdmin(session, 'my-farm');
    // If the slug check used the wrong slug, ADMIN for 'my-farm' would have
    // been missed and a redirect would have been thrown.
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects when the session is for a different farm slug', async () => {
    const session = makeSession({
      farms: [{ slug: 'other-farm', role: 'ADMIN' }],
    } as never);

    // Session has ADMIN on 'other-farm' but we're checking 'requested-farm'
    await expect(requireFarmAdmin(session, 'requested-farm')).rejects.toThrow('__REDIRECT__:');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// requirePlatformAdmin — security-critical: FAIL-CLOSED behaviour
// ─────────────────────────────────────────────────────────────────────────

describe('requirePlatformAdmin', () => {
  it('resolves (no redirect) when isPlatformAdmin returns true', async () => {
    const session = makeSession({ email: 'luc@farmtrack.app' });
    isPlatformAdminMock.mockResolvedValueOnce(true);

    await expect(requirePlatformAdmin(session)).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects when isPlatformAdmin returns false', async () => {
    const session = makeSession({ email: 'regular@farm.com' });
    isPlatformAdminMock.mockResolvedValueOnce(false);

    await expect(requirePlatformAdmin(session)).rejects.toThrow('__REDIRECT__:');
  });

  it('FAIL-CLOSED: redirects when isPlatformAdmin throws (meta-db unreachable)', async () => {
    // ── SECURITY-CRITICAL TEST ──
    // If the meta-store is unreachable, we MUST NOT grant platform-admin
    // access. The guard wraps the call in try/catch and treats ANY error as
    // NOT-admin (redirect). Granting access on error would be catastrophic.
    const session = makeSession({ email: 'attacker@evil.com' });
    isPlatformAdminMock.mockRejectedValueOnce(new Error('meta-db connection refused'));

    await expect(requirePlatformAdmin(session)).rejects.toThrow('__REDIRECT__:');
    expect(redirectMock).toHaveBeenCalled();
  });

  it('FAIL-CLOSED: redirects when isPlatformAdmin rejects with a network timeout', async () => {
    const session = makeSession({ email: 'attacker@evil.com' });
    isPlatformAdminMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await expect(requirePlatformAdmin(session)).rejects.toThrow('__REDIRECT__:');
  });

  it('FAIL-CLOSED: redirects when isPlatformAdmin rejects with a credentials error', async () => {
    const session = makeSession({ email: 'attacker@evil.com' });
    isPlatformAdminMock.mockRejectedValueOnce(new Error('invalid token'));

    await expect(requirePlatformAdmin(session)).rejects.toThrow('__REDIRECT__:');
  });

  it('calls isPlatformAdmin with the session user email', async () => {
    const session = makeSession({ email: 'luc@farmtrack.app' });
    isPlatformAdminMock.mockResolvedValueOnce(true);

    await requirePlatformAdmin(session);
    expect(isPlatformAdminMock).toHaveBeenCalledWith('luc@farmtrack.app');
  });

  it('redirects when session user has no email (undefined) — no isPlatformAdmin call', async () => {
    // Edge case: session.user.email is undefined. Guard must redirect without
    // even calling isPlatformAdmin (no email = no lookup possible).
    const session = makeSession({ email: undefined as unknown as string });

    await expect(requirePlatformAdmin(session)).rejects.toThrow('__REDIRECT__:');
    // isPlatformAdmin should NOT have been called with undefined
    expect(isPlatformAdminMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getUserRoleForFarm (smoke test to ensure the existing primitive is intact)
// ─────────────────────────────────────────────────────────────────────────

describe('getUserRoleForFarm (existing primitive — regression guard)', () => {
  it('returns the role for a known farm slug', () => {
    const session = makeSession({
      farms: [
        { slug: 'farm-a', role: 'ADMIN' },
        { slug: 'farm-b', role: 'LOGGER' },
      ],
    } as never);
    expect(getUserRoleForFarm(session, 'farm-a')).toBe('ADMIN');
    expect(getUserRoleForFarm(session, 'farm-b')).toBe('LOGGER');
  });

  it('returns null for an unknown slug', () => {
    const session = makeSession({ farms: [] } as never);
    expect(getUserRoleForFarm(session, 'unknown')).toBeNull();
  });
});
