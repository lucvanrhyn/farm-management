/**
 * @vitest-environment node
 *
 * __tests__/app/sheep-global-redirect.test.tsx — Wave 6a / Issue #260
 *
 * TenantRouteGuard: global `/sheep/animals`, `/sheep/camps`, and
 * `/sheep/observations` paths must NOT 404. They are a leak in the ADR-0003
 * asymmetric route shape — sheep lives at `/[farmSlug]/sheep/*` only — but
 * users (and external links, bookmarks, marketing emails) routinely drop the
 * tenant slug and hit the bare `/sheep/...` form.
 *
 * The guard lives in `proxy.ts` (project uses proxy.ts-only middleware per
 * `project-stack.md`) and applies the following redirect matrix:
 *
 *   | State                      | Path             | Expected                                      |
 *   |----------------------------|------------------|-----------------------------------------------|
 *   | Unauthenticated            | /sheep/animals   | 302 → /login?next=/sheep/animals              |
 *   | Authed, multi-tenant       | /sheep/animals   | 302 → /farms?toast=pick-a-farm                |
 *   | Authed, single-tenant      | /sheep/animals   | 302 → /{slug}/sheep/animals                   |
 *
 * The same matrix applies to /sheep/camps and /sheep/observations. Other
 * `/sheep/*` paths (e.g. /sheep, /sheep/breeding) are out of scope for this
 * wave — the guard only covers the three documented leak paths.
 *
 * Modeled on the matrix-table style of `__tests__/app/sheep-reproduction-cattle-only.test.tsx`
 * with the test-runner shape of `__tests__/api/proxy-login-next.test.ts` (real
 * proxy() invocation against a mocked next-auth/jwt).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'test-nextauth-secret';
process.env.NEXTAUTH_SECRET = SECRET;

const getTokenMock = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: (...args: unknown[]) => getTokenMock(...args),
}));

function makeReq(pathname: string, search = ''): NextRequest {
  const url = `https://app.example${pathname}${search}`;
  return new NextRequest(url);
}

const SHEEP_LEAK_PATHS = [
  '/sheep/animals',
  '/sheep/camps',
  '/sheep/observations',
] as const;

describe('TenantRouteGuard — global /sheep/* redirect (Issue #260)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Row 1: Unauthenticated → /login?next=… ─────────────────────────────────
  describe('unauthenticated visitor', () => {
    beforeEach(() => {
      getTokenMock.mockResolvedValue(null);
    });

    for (const path of SHEEP_LEAK_PATHS) {
      it(`redirects ${path} to /login?next=${path}`, async () => {
        const { proxy } = await import('@/proxy');
        const res = await proxy(makeReq(path));

        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
        const url = new URL(res.headers.get('location')!);
        expect(url.pathname).toBe('/login');
        expect(url.searchParams.get('next')).toBe(path);
      });
    }
  });

  // ── Row 2: Authed, multi-tenant → /farms?toast=pick-a-farm ─────────────────
  describe('authenticated visitor with multiple tenants', () => {
    beforeEach(() => {
      getTokenMock.mockResolvedValue({
        sub: 'user-1',
        email: 'multi@example.com',
        farms: [
          {
            slug: 'trio-b-boerdery',
            tier: 'advanced',
            subscriptionStatus: 'active',
            role: 'ADMIN',
          },
          {
            slug: 'basson-boerdery',
            tier: 'advanced',
            subscriptionStatus: 'active',
            role: 'ADMIN',
          },
        ],
      });
    });

    for (const path of SHEEP_LEAK_PATHS) {
      it(`redirects ${path} to /farms?toast=pick-a-farm`, async () => {
        const { proxy } = await import('@/proxy');
        const res = await proxy(makeReq(path));

        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
        const url = new URL(res.headers.get('location')!);
        expect(url.pathname).toBe('/farms');
        expect(url.searchParams.get('toast')).toBe('pick-a-farm');
      });
    }
  });

  // ── Row 3: Authed, single tenant → /{slug}/sheep/... ───────────────────────
  describe('authenticated visitor with exactly one tenant', () => {
    const SOLO_SLUG = 'solo-farm';
    beforeEach(() => {
      getTokenMock.mockResolvedValue({
        sub: 'user-2',
        email: 'solo@example.com',
        farms: [
          {
            slug: SOLO_SLUG,
            tier: 'advanced',
            subscriptionStatus: 'active',
            role: 'ADMIN',
          },
        ],
      });
    });

    for (const path of SHEEP_LEAK_PATHS) {
      it(`redirects ${path} to /${SOLO_SLUG}${path}`, async () => {
        const { proxy } = await import('@/proxy');
        const res = await proxy(makeReq(path));

        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
        const url = new URL(res.headers.get('location')!);
        expect(url.pathname).toBe(`/${SOLO_SLUG}${path}`);
      });
    }

    it('preserves query strings on single-tenant rewrite', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/sheep/animals', '?filter=active'));
      const url = new URL(res.headers.get('location')!);
      expect(url.pathname).toBe(`/${SOLO_SLUG}/sheep/animals`);
      expect(url.searchParams.get('filter')).toBe('active');
    });
  });

  // ── Regression guards ──────────────────────────────────────────────────────
  describe('regression guards', () => {
    it('does NOT intercept /[slug]/sheep/animals (already a real route)', async () => {
      // Authenticated, single tenant — the slug-prefixed path must NOT be
      // re-redirected. It belongs to the existing tenant route tree.
      getTokenMock.mockResolvedValue({
        sub: 'user-3',
        email: 'tenant@example.com',
        farms: [
          {
            slug: 'solo-farm',
            tier: 'advanced',
            subscriptionStatus: 'active',
            role: 'ADMIN',
          },
        ],
      });

      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/solo-farm/sheep/animals'));

      // Either passes through (200/next) or redirects elsewhere — but it
      // MUST NOT redirect to /farms?toast=pick-a-farm or /login.
      const loc = res.headers.get('location');
      if (loc) {
        const url = new URL(loc, 'https://app.example');
        expect(url.pathname).not.toBe('/farms');
        expect(url.pathname).not.toBe('/login');
      }
    });

    it('isProtectedPath() includes /sheep/animals so unauth flow hits the redirect', async () => {
      // The unauth row only works if isProtectedPath() returns true for the
      // bare /sheep/* leak paths — otherwise the matcher falls through to
      // app/not-found.tsx and the user gets a 404 instead of a /login bounce.
      const { isProtectedPath } = await import('@/proxy');
      for (const path of SHEEP_LEAK_PATHS) {
        expect(isProtectedPath(path)).toBe(true);
      }
    });
  });
});
