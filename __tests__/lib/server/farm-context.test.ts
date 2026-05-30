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
 *  - If headers are missing or fail HMAC verification (tests, a direct
 *    fetch bypassing proxy, or a forged header), getFarmContext returns
 *    `null` and the caller mints a 401. Issue #495 (PRD #479) removed the
 *    legacy `getServerSession` + `getPrismaWithAuth` Referer-fallback path:
 *    the signed-header hop is now the SOLE tenant source for cookie-scoped
 *    `/api/*` routes, so there is no Referer-based recovery here.
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

// Issue #495: `getFarmContext` no longer falls back to the legacy
// `getServerSession` + `getPrismaWithAuth` Referer path. The signed-header
// fast path is the only tenant source, so the farm-prisma surface this test
// needs is just the slug→client acquire + the retry wrapper.
vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// ── Helpers ───────────────────────────────────────────────────────────────
function signHeaders(
  userEmail: string,
  slug: string,
  userId = 'user-1',
  role = 'ADMIN',
): Record<string, string> {
  // Phase G (P6.5): signature payload binds `sub` (user id) so migrated
  // admin-write handlers can call `verifyFreshAdminRole(session.user.id, slug)`
  // without an empty-string id silently rejecting every ADMIN.
  // Wave 1 W1b: payload also binds `role` and a leading `v2` version byte.
  const sig = createHmac('sha256', SECRET)
    .update(`v2\n${userEmail}\n${slug}\n${userId}\n${role}`)
    .digest('hex');
  return {
    'x-session-user': userEmail,
    'x-farm-slug': slug,
    'x-session-role': role,
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
  });

  it('(a) returns {session, prisma, slug} in one await when proxy has signed headers', async () => {
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest(signHeaders('user-1@example.com', 'trio-b'));

    const ctx = await getFarmContext(req);

    expect(ctx).not.toBeNull();
    expect(ctx!.slug).toBe('trio-b');
    expect(ctx!.prisma).toBe(mockPrisma);
    expect(ctx!.session.user?.email).toBe('user-1@example.com');
    expect(getPrismaForFarmMock).toHaveBeenCalledWith('trio-b');
  });

  it('(b) #495: returns null when signed headers are absent — NO Referer fallback', async () => {
    // Pre-#495 this fell back to getServerSession + getPrismaWithAuth (the
    // Referer-to-slug path). That dead net is gone: a request that did not
    // pass through the proxy's signed-header hop is treated as
    // unauthenticated, and the caller mints a 401. No Prisma is acquired.
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest();

    const ctx = await getFarmContext(req);

    expect(ctx).toBeNull();
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

  it('(f) SECURITY: unsigned client-supplied x-farm-slug is IGNORED → null (#495: no fallback)', async () => {
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest({
      'x-session-user': 'attacker@example.com',
      'x-farm-slug': 'target-farm',
      // No x-session-sig header — attacker cannot forge HMAC without secret
    });

    const ctx = await getFarmContext(req);

    // Unsigned headers must not be trusted. Pre-#495 the helper fell back to
    // the legacy Referer auth path; now the request is simply unauthenticated.
    // The spoofed slug never reaches a Prisma acquire.
    expect(ctx).toBeNull();
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
  });

  it('(g) SECURITY: invalid HMAC signature is rejected → null (#495: no fallback)', async () => {
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const req = makeRequest({
      'x-session-user': 'user-1@example.com',
      'x-farm-slug': 'target-farm',
      'x-session-sig': 'a'.repeat(64), // garbage of the right length
    });

    const ctx = await getFarmContext(req);

    expect(ctx).toBeNull();
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
  });
});
