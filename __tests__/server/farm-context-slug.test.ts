/**
 * @vitest-environment node
 *
 * Phase G (P6.5) — unit tests for getFarmContextForSlug().
 *
 * The helper guards against the cookie-vs-URL slug mismatch that
 * proxy.ts's signed header triplet cannot catch on /api/[farmSlug]/* paths
 * (proxy.ts derives the signed slug from either the farm-page URL regex
 * or the active_farm_slug cookie — neither matches /api/farm-slug/...).
 *
 * Cases covered:
 *   (1) proxy-signed slug == URL slug → fast-path context returned directly
 *   (2) proxy-signed slug != URL slug → falls back to legacy path via
 *       getPrismaForSlugWithAuth(session, slug); returns context scoped to
 *       the URL slug (not the signed one)
 *   (3) no proxy headers → legacy getServerSession path
 *   (4) user has no access to URL slug → null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';

const SECRET = 'test-nextauth-secret';
process.env.NEXTAUTH_SECRET = SECRET;

// ── Mocks ─────────────────────────────────────────────────────────────────
const getPrismaForFarmMock = vi.fn();
const getPrismaForSlugWithAuthMock = vi.fn();
const getPrismaWithAuthMock = vi.fn();
const getServerSessionMock = vi.fn();

vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  getPrismaWithAuth: getPrismaWithAuthMock,
  getPrismaForSlugWithAuth: getPrismaForSlugWithAuthMock,
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

// ── Helpers ───────────────────────────────────────────────────────────────
// Wave 1 W1b: HMAC payload is `v2\n<email>\n<slug>\n<sub>\n<role>`.
function sign(email: string, slug: string, sub: string, role: string): string {
  return createHmac('sha256', SECRET)
    .update(`v2\n${email}\n${slug}\n${sub}\n${role}`)
    .digest('hex');
}

function makeReqWithSignedHeaders(opts: {
  email: string;
  slug: string;
  sub: string;
  role: string;
}): NextRequest {
  const sig = sign(opts.email, opts.slug, opts.sub, opts.role);
  const headers = new Headers();
  headers.set('x-session-user', opts.email);
  headers.set('x-farm-slug', opts.slug);
  headers.set('x-session-role', opts.role);
  headers.set('x-session-sub', opts.sub);
  headers.set('x-session-sig', sig);
  return new NextRequest('http://localhost/api/trio-b/transactions', { headers });
}

function makeReqNoHeaders(): NextRequest {
  return new NextRequest('http://localhost/api/trio-b/transactions');
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe('getFarmContextForSlug', () => {
  beforeEach(() => {
    vi.resetModules();
    getPrismaForFarmMock.mockReset();
    getPrismaForSlugWithAuthMock.mockReset();
    getPrismaWithAuthMock.mockReset();
    getServerSessionMock.mockReset();
    // Sensible default — the legacy code path inside getFarmContext calls
    // getPrismaWithAuth when no signed headers are present. Tests that
    // exercise that path override this explicitly.
    getPrismaWithAuthMock.mockResolvedValue({ error: 'no-op', status: 400 });
  });

  it('(1) proxy-signed slug matches URL slug → returns fast-path context with user.id', async () => {
    const fakePrisma = { marker: 'fast' };
    getPrismaForFarmMock.mockResolvedValue(fakePrisma);

    const { getFarmContextForSlug } = await import('@/lib/server/farm-context-slug');

    const req = makeReqWithSignedHeaders({
      email: 'alice@example.com',
      slug: 'trio-b',
      sub: 'user-alice-id',
      role: 'ADMIN',
    });

    const ctx = await getFarmContextForSlug('trio-b', req);
    expect(ctx).not.toBeNull();
    expect(ctx!.slug).toBe('trio-b');
    expect(ctx!.role).toBe('ADMIN');
    expect(ctx!.prisma).toBe(fakePrisma);
    // CRITICAL: session.user.id must be populated so verifyFreshAdminRole
    // gets the real user id, not the empty string.
    expect(ctx!.session.user.id).toBe('user-alice-id');
    expect(ctx!.session.user.email).toBe('alice@example.com');

    // Fast path — no legacy fallback.
    expect(getPrismaForSlugWithAuthMock).not.toHaveBeenCalled();
    expect(getServerSessionMock).not.toHaveBeenCalled();
  });

  it('(2) cookie points at farm A but URL is farm B → legacy fallback scoped to URL slug', async () => {
    // Fast path resolves to farm A (from the cookie-set signed header)...
    getPrismaForFarmMock.mockResolvedValue({ marker: 'A' });
    // ...but the fallback must re-auth against farm B.
    getPrismaForSlugWithAuthMock.mockResolvedValue({
      prisma: { marker: 'B' },
      slug: 'farm-b',
      role: 'LOGGER',
    });

    const { getFarmContextForSlug } = await import('@/lib/server/farm-context-slug');

    // Signed headers claim "farm-a", URL asks for "farm-b". User is a
    // member of both — session carries both in farms[].
    const req = makeReqWithSignedHeaders({
      email: 'bob@example.com',
      slug: 'farm-a',
      sub: 'user-bob-id',
      role: 'ADMIN',
    });
    // The fast-path synthesised session only carries farm-a in farms[],
    // so the helper must re-issue getServerSession to learn about farm-b.
    getServerSessionMock.mockResolvedValue({
      user: {
        id: 'user-bob-id',
        email: 'bob@example.com',
        farms: [
          { slug: 'farm-a', role: 'ADMIN' },
          { slug: 'farm-b', role: 'LOGGER' },
        ],
      },
    });

    const ctx = await getFarmContextForSlug('farm-b', req);
    expect(ctx).not.toBeNull();
    expect(ctx!.slug).toBe('farm-b');
    expect(ctx!.role).toBe('LOGGER');
    expect((ctx!.prisma as unknown as { marker: string }).marker).toBe('B');

    // Fallback was used (legacy helper invoked with URL slug, not signed slug).
    expect(getPrismaForSlugWithAuthMock).toHaveBeenCalledTimes(1);
    expect(getPrismaForSlugWithAuthMock.mock.calls[0][1]).toBe('farm-b');
  });

  it('(3) no proxy headers → legacy getServerSession path', async () => {
    const fakeSession = {
      user: {
        id: 'user-x',
        email: 'x@example.com',
        farms: [{ slug: 'trio-b', role: 'ADMIN' }],
      },
    };
    getServerSessionMock.mockResolvedValue(fakeSession);
    getPrismaForSlugWithAuthMock.mockResolvedValue({
      prisma: { marker: 'legacy' },
      slug: 'trio-b',
      role: 'ADMIN',
    });

    const { getFarmContextForSlug } = await import('@/lib/server/farm-context-slug');

    const req = makeReqNoHeaders();
    const ctx = await getFarmContextForSlug('trio-b', req);
    expect(ctx).not.toBeNull();
    expect(ctx!.slug).toBe('trio-b');
    expect(ctx!.role).toBe('ADMIN');
    expect(ctx!.session.user.id).toBe('user-x');

    expect(getServerSessionMock).toHaveBeenCalled();
    expect(getPrismaForSlugWithAuthMock).toHaveBeenCalled();
  });

  it('(4) session user has no access to URL slug → null', async () => {
    // Fast path with signed slug = farm-a, URL = farm-b, user has NO farm-b.
    getPrismaForFarmMock.mockResolvedValue({ marker: 'A' });
    getServerSessionMock.mockResolvedValue({
      user: {
        id: 'user-carol',
        email: 'carol@example.com',
        farms: [{ slug: 'farm-a', role: 'ADMIN' }],
      },
    });
    getPrismaForSlugWithAuthMock.mockResolvedValue({
      error: 'Forbidden',
      status: 403,
    });

    const { getFarmContextForSlug } = await import('@/lib/server/farm-context-slug');

    const req = makeReqWithSignedHeaders({
      email: 'carol@example.com',
      slug: 'farm-a',
      sub: 'user-carol',
      role: 'ADMIN',
    });

    const ctx = await getFarmContextForSlug('farm-b', req);
    expect(ctx).toBeNull();
  });
});
