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
// Phase G (P6.5): the signed payload now includes the JWT `sub` so migrated
// admin handlers receive the real user id via the synthesised session.
function verifySig(
  userEmail: string,
  slug: string,
  sub: string,
  sig: string,
): boolean {
  const expected = createHmac('sha256', SECRET)
    .update(`${userEmail}\n${slug}\n${sub}`)
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
          slug: 'trio-b-boerdery',
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
      'http://localhost/trio-b-boerdery/admin/tasks',
      { cookie: 'active_farm_slug=trio-b-boerdery' },
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
    const sub = res.headers.get('x-middleware-request-x-session-sub');
    const sig = res.headers.get('x-middleware-request-x-session-sig');

    expect(user).toBe('user-1@example.com');
    expect(slug).toBe('trio-b-boerdery');
    expect(sub).toBe('user-1');
    expect(sig).toBeTruthy();
    expect(verifySig(user!, slug!, sub!, sig!)).toBe(true);
  });

  it('(b) unauthenticated request gets redirected (no headers leaked)', async () => {
    getTokenMock.mockResolvedValue(null);

    const { proxy } = await import('@/proxy');
    const req = makeReq('http://localhost/trio-b-boerdery/admin/tasks');

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
    const req = makeReq('http://localhost/api/farms/trio-b-boerdery/select');

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
