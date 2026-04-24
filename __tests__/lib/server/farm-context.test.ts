/**
 * @vitest-environment node
 *
 * Phase D (P6) — consolidate session + prisma acquire via proxy hoist.
 *
 * `getFarmContext(req)` is the route-side half of the optimization:
 *  - If proxy.ts already authenticated the request, it injects a signed
 *    header triplet (`x-session-user`, `x-farm-slug`, `x-session-sig`).
 *    getFarmContext verifies the HMAC and skips the ~80–120ms
 *    `getServerSession` round-trip, resolving the Prisma client directly
 *    from the signed slug.
 *  - If headers are missing (tests, direct fetch bypassing proxy), it
 *    falls back to the legacy `getServerSession` + `getPrismaWithAuth`
 *    path so behaviour is identical.
 *  - Unsigned client-supplied headers MUST be ignored — otherwise an
 *    attacker could spoof tenant identity by sending `x-farm-slug`.
 *  - Results are memoised per request so re-entry (nested helper calls
 *    in a single handler) acquires Prisma once.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';

const SECRET = 'test-nextauth-secret';
process.env.NEXTAUTH_SECRET = SECRET;

// ── Mocks ─────────────────────────────────────────────────────────────────
const mockPrisma = { __tag: 'mock-prisma' };

const getPrismaForFarmMock = vi.fn(async (slug: string) => {
  if (slug === 'forbidden-farm') return null;
  return mockPrisma as unknown as import('@prisma/client').PrismaClient;
});

const getPrismaWithAuthMock = vi.fn(async () => ({
  prisma: mockPrisma as unknown as import('@prisma/client').PrismaClient,
  slug: 'legacy-farm',
  role: 'ADMIN',
}));

vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  getPrismaWithAuth: getPrismaWithAuthMock,
}));

const getServerSessionMock = vi.fn();
vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

// ── Helpers ───────────────────────────────────────────────────────────────
function signHeaders(
  userEmail: string,
  slug: string,
  userId = 'user-1',
): Record<string, string> {
  // Phase G (P6.5): signature payload now binds `sub` (user id) too so
  // migrated admin-write handlers can call `verifyFreshAdminRole(session.user.id, slug)`
  // without an empty-string id silently rejecting every ADMIN.
  const sig = createHmac('sha256', SECRET)
    .update(`${userEmail}\n${slug}\n${userId}`)
    .digest('hex');
  return {
    'x-session-user': userEmail,
    'x-farm-slug': slug,
    'x-session-role': 'ADMIN',
    'x-session-sub': userId,
    'x-session-sig': sig,
  };
}

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/camps', { headers });
}

describe('getFarmContext', () => {
  beforeEach(() => {
    vi.resetModules();
    getPrismaForFarmMock.mockClear();
    getPrismaWithAuthMock.mockClear();
    getServerSessionMock.mockReset();
    getServerSessionMock.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user-1@example.com',
        farms: [{ slug: 'legacy-farm', role: 'ADMIN' }],
      },
    });
  });

  it('(a) returns {session, prisma, slug} in one await when proxy has signed headers', async () => {
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest(signHeaders('user-1@example.com', 'trio-b'));

    const ctx = await getFarmContext(req);

    expect(ctx).not.toBeNull();
    expect(ctx!.slug).toBe('trio-b');
    expect(ctx!.prisma).toBe(mockPrisma);
    expect(ctx!.session.user?.email).toBe('user-1@example.com');
    // The whole point of the optimization: legacy session fetch never runs
    expect(getServerSessionMock).not.toHaveBeenCalled();
    expect(getPrismaWithAuthMock).not.toHaveBeenCalled();
    expect(getPrismaForFarmMock).toHaveBeenCalledWith('trio-b');
  });

  it('(b) falls back to legacy getServerSession + getPrismaWithAuth when headers absent', async () => {
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest();

    const ctx = await getFarmContext(req);

    expect(ctx).not.toBeNull();
    expect(ctx!.slug).toBe('legacy-farm');
    expect(getServerSessionMock).toHaveBeenCalledTimes(1);
    expect(getPrismaWithAuthMock).toHaveBeenCalledTimes(1);
  });

  it('(c) unauthorised request (no session, no signed header) returns null without touching Prisma', async () => {
    getServerSessionMock.mockResolvedValueOnce(null);
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest();

    const ctx = await getFarmContext(req);

    expect(ctx).toBeNull();
    expect(getPrismaWithAuthMock).not.toHaveBeenCalled();
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
  });

  it('(d) same-request re-entry is memoised (Prisma acquire runs once even across 3 calls)', async () => {
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest(signHeaders('user-1@example.com', 'trio-b'));

    const a = await getFarmContext(req);
    const b = await getFarmContext(req);
    const c = await getFarmContext(req);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(getPrismaForFarmMock).toHaveBeenCalledTimes(1);
  });

  it('(e) farm-slug not resolvable returns the same {error,status} shape as getPrismaWithAuth today', async () => {
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest(signHeaders('user-1@example.com', 'forbidden-farm'));

    const ctx = await getFarmContext(req);

    // getPrismaForFarm returned null → farm not found → null context.
    expect(ctx).toBeNull();
  });

  it('(f) SECURITY: unsigned client-supplied x-farm-slug is IGNORED — falls through to legacy auth', async () => {
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest({
      'x-session-user': 'attacker@example.com',
      'x-farm-slug': 'target-farm',
      // No x-session-sig header — attacker cannot forge HMAC without secret
    });

    const ctx = await getFarmContext(req);

    // Unsigned headers must not be trusted; helper falls back to legacy auth
    expect(getServerSessionMock).toHaveBeenCalledTimes(1);
    expect(getPrismaWithAuthMock).toHaveBeenCalledTimes(1);
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
    // Resulting context uses the legitimate session, not the spoofed slug
    expect(ctx!.slug).toBe('legacy-farm');
  });

  it('(g) SECURITY: invalid HMAC signature is rejected (treated as unsigned)', async () => {
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest({
      'x-session-user': 'user-1@example.com',
      'x-farm-slug': 'target-farm',
      'x-session-sig': 'a'.repeat(64), // garbage of the right length
    });

    const ctx = await getFarmContext(req);

    expect(getServerSessionMock).toHaveBeenCalledTimes(1);
    expect(getPrismaWithAuthMock).toHaveBeenCalledTimes(1);
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
    expect(ctx!.slug).toBe('legacy-farm');
  });
});
