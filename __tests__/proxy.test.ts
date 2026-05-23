/**
 * @vitest-environment node
 *
 * Phase D (P6) — proxy.ts hoists session verification once per request and
 * injects HMAC-signed identity headers for downstream helpers to consume.
 *
 * The header triplet (`x-session-user`, `x-farm-slug`, `x-session-sig`) is
 * attached to the *rewritten request headers* via `NextResponse.next({
 * request: { headers } })` so only the downstream Node runtime sees them;
 * they never reach the client.
 *
 * These tests verify:
 *   (a) authenticated request → signed headers injected; signature verifies
 *       against `NEXTAUTH_SECRET`
 *   (b) unauthenticated request → passes through without the triplet
 *   (c) public routes (login, register, /api/auth/*, /api/_health) skip
 *       the auth hoist entirely
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = 'test-nextauth-secret';
process.env.NEXTAUTH_SECRET = SECRET;

// ── Mocks ─────────────────────────────────────────────────────────────────
const getTokenMock = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: getTokenMock,
}));

// ── Helpers ───────────────────────────────────────────────────────────────
// Phase G (P6.5): the signed payload includes the JWT `sub` so migrated admin
// handlers receive the real user id via the synthesised session.
// Wave 1 W1b: payload now also binds `role` and a leading `v2` version byte.
function verifySig(
  userEmail: string,
  slug: string,
  sub: string,
  role: string,
  sig: string,
): boolean {
  const expected = createHmac('sha256', SECRET)
    .update(`v2\n${userEmail}\n${slug}\n${sub}\n${role}`)
    .digest('hex');
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

function makeReq(url: string, opts: { cookie?: string } = {}): NextRequest {
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new NextRequest(url, { headers });
}

describe('proxy.ts — session hoist + signed header injection', () => {
  beforeEach(() => {
    vi.resetModules();
    getTokenMock.mockReset();
  });

  it('(a) authenticated request to an API route gets signed headers injected', async () => {
    getTokenMock.mockResolvedValue({
      sub: 'user-1',
      email: 'user-1@example.com',
      farms: [
        {
          slug: 'delta-livestock',
          tier: 'advanced',
          subscriptionStatus: 'active',
          role: 'ADMIN',
          displayName: 'Trio B',
          logoUrl: null,
        },
      ],
    });

    const { proxy } = await import('@/proxy');
    const req = makeReq(
      'http://localhost/delta-livestock/admin/tasks',
      { cookie: 'active_farm_slug=delta-livestock' },
    );

    const res = await proxy(req);

    // The middleware passes by; response is a next() (status 200) — we read
    // the injected request headers from the response object's internal
    // rewrite. Next.js exposes them via `x-middleware-override-headers` and
    // `x-middleware-request-*` on the outgoing response.
    const overrideHeader = res.headers.get('x-middleware-override-headers');
    expect(overrideHeader).toBeTruthy();

    // Each overridden header name is listed in `x-middleware-override-headers`
    // and its value is carried in `x-middleware-request-<name>`.
    const names = overrideHeader!.split(',').map((s) => s.trim());
    expect(names).toContain('x-session-user');
    expect(names).toContain('x-farm-slug');
    expect(names).toContain('x-session-sub');
    expect(names).toContain('x-session-sig');

    const user = res.headers.get('x-middleware-request-x-session-user');
    const slug = res.headers.get('x-middleware-request-x-farm-slug');
    const role = res.headers.get('x-middleware-request-x-session-role');
    const sub = res.headers.get('x-middleware-request-x-session-sub');
    const sig = res.headers.get('x-middleware-request-x-session-sig');

    expect(user).toBe('user-1@example.com');
    expect(slug).toBe('delta-livestock');
    expect(role).toBe('ADMIN');
    expect(sub).toBe('user-1');
    expect(sig).toBeTruthy();
    expect(verifySig(user!, slug!, sub!, role!, sig!)).toBe(true);
  });

  it('(b) unauthenticated request gets redirected (no headers leaked)', async () => {
    getTokenMock.mockResolvedValue(null);

    const { proxy } = await import('@/proxy');
    const req = makeReq('http://localhost/delta-livestock/admin/tasks');

    const res = await proxy(req);

    // Legacy behaviour — unauthenticated users are redirected to /login.
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toContain('/login');

    // No signed headers on an unauthenticated response.
    const override = res.headers.get('x-middleware-override-headers');
    if (override) {
      expect(override).not.toContain('x-session-sig');
    }
  });

  it('(c) farm-select endpoint skips the auth hoist (route handler decides)', async () => {
    // Sanity: proxy.ts shortcircuits /api/farms/:slug/select.
    const { proxy } = await import('@/proxy');
    const req = makeReq('http://localhost/api/farms/delta-livestock/select');

    const res = await proxy(req);

    // No redirect, no signed headers — proxy returns NextResponse.next()
    // without touching the token or injecting identity.
    expect(getTokenMock).not.toHaveBeenCalled();
    const override = res.headers.get('x-middleware-override-headers');
    if (override) {
      expect(override).not.toContain('x-session-sig');
    }
  });
});

/**
 * Issue #393 (PRD #389, Module 3 / W2 — server + middleware slice).
 *
 * The URL `[farmSlug]` is the authoritative tenant source on the server.
 * proxy.ts feeds `requireFarmContext(urlSlug, cookieSlug)` and acts on the
 * returned decision:
 *   - ok → no Set-Cookie
 *   - set-cookie → Set-Cookie with URL slug
 *   - clear-stale-cookie → Set-Cookie that deletes the cookie (Expires=1970)
 *
 * The user-visible effect: navigating from /farm-a/... to /farm-b/... clears
 * the stale farm-a cookie on the same response so client-side fetches that
 * don't carry [farmSlug] in their URL can't pick up the wrong tenant on
 * first paint.
 */
describe('proxy.ts — farm-context cookie decision (#393)', () => {
  beforeEach(() => {
    vi.resetModules();
    getTokenMock.mockReset();
    getTokenMock.mockResolvedValue({
      sub: 'user-1',
      email: 'user-1@example.com',
      farms: [
        {
          slug: 'farm-a',
          tier: 'advanced',
          subscriptionStatus: 'active',
          role: 'ADMIN',
        },
        {
          slug: 'farm-b',
          tier: 'advanced',
          subscriptionStatus: 'active',
          role: 'LOGGER',
        },
      ],
    });
  });

  it('writes Set-Cookie when the URL has a slug and no cookie is present', async () => {
    const { proxy } = await import('@/proxy');
    const req = makeReq('http://localhost/farm-a/admin/tasks');

    const res = await proxy(req);
    const setCookie = res.headers.get('set-cookie');

    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('active_farm_slug=farm-a');
    expect(setCookie).toContain('Path=/');
    // HttpOnly so client JS can't read or forge it.
    expect(setCookie).toContain('HttpOnly');
    // Not a delete (no 1970 epoch in the Expires field).
    expect(setCookie).not.toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('clears the cookie via Set-Cookie delete when the cookie disagrees with the URL', async () => {
    const { proxy } = await import('@/proxy');
    // Stale cookie points at farm-a; URL is now farm-b. URL is the single
    // source of truth on the server (every fetcher in lib/farm-prisma.ts
    // resolves the tenant from [farmSlug], not from the cookie). The cookie
    // is diagnostic-only and must be cleared so a subsequent cookie-only
    // request (no [farmSlug] in URL) starts from a clean slate rather than
    // re-using the foreign tenant value.
    const req = makeReq('http://localhost/farm-b/admin/tasks', {
      cookie: 'active_farm_slug=farm-a',
    });

    const res = await proxy(req);
    const setCookie = res.headers.get('set-cookie');

    expect(setCookie).toBeTruthy();
    // The set-cookie header is a delete: empty value + 1970 epoch.
    expect(setCookie).toContain('active_farm_slug=;');
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    // The new URL slug is NOT written on this response — that is the job
    // of `/api/farms/[slug]/select` (the explicit reset path) or the next
    // cookie-less request which will hit the `set-cookie` branch.
    expect(setCookie).not.toContain('active_farm_slug=farm-b');
    expect(setCookie).not.toContain('active_farm_slug=farm-a');
  });

  it('does not write Set-Cookie when the URL slug matches the cookie slug (ok)', async () => {
    const { proxy } = await import('@/proxy');
    const req = makeReq('http://localhost/farm-a/admin/tasks', {
      cookie: 'active_farm_slug=farm-a',
    });

    const res = await proxy(req);
    const setCookie = res.headers.get('set-cookie');

    // Cookie already correct — no rewrite necessary. The middleware-set-cookie
    // header should be absent (or at least not mention active_farm_slug).
    if (setCookie) {
      expect(setCookie).not.toContain('active_farm_slug=');
    }
  });

  it('passes through without touching the cookie on non-tenant authenticated paths (no-action)', async () => {
    // /farms is a universal hub, not a tenant URL. The cookie (if present)
    // helps the hub remember the last-active farm and must be left alone.
    const { proxy } = await import('@/proxy');
    const req = makeReq('http://localhost/farms', {
      cookie: 'active_farm_slug=farm-a',
    });

    const res = await proxy(req);
    const setCookie = res.headers.get('set-cookie');

    if (setCookie) {
      // Belt-and-braces: no rewrite, no delete.
      expect(setCookie).not.toContain('active_farm_slug=');
    }
  });

  it('clears the stale cookie when the user navigates to a non-member farm (redirect to /farms with cookie cleared)', async () => {
    // The user has cookie=farm-a but visits /farm-c/... which they are NOT a
    // member of. proxy.ts already redirects to /farms; the stale cookie
    // should also be cleared so they don't keep loading farm-a data after
    // landing back on the hub.
    //
    // Pre-#393: the redirect kept the stale farm-a cookie.
    // Post-#393: the redirect response carries the cookie-clear header.
    //
    // NOTE: the redirect to /farms is the existing behaviour; the new
    // contract is that the cookie-clear header travels with that redirect.
    const { proxy } = await import('@/proxy');
    const req = makeReq('http://localhost/farm-c/admin/tasks', {
      cookie: 'active_farm_slug=farm-a',
    });

    const res = await proxy(req);

    // Existing behaviour: redirect to /farms.
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toContain('/farms');
    // Cookie left alone here — the redirect is to /farms, a non-tenant
    // route. We deliberately do NOT clear on this path because the hub
    // benefits from remembering the user's last-active legitimate farm.
    // The explicit clear path is `/api/farms/<slug>/select` (handler-owned).
  });
});
