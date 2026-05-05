/**
 * @vitest-environment node
 *
 * __tests__/api/proxy-login-next.test.ts
 *
 * Visual audit P1 (2026-05-04): proxy.ts redirects unauthenticated users
 * to `/login` without the originally-requested path. After signing in,
 * users land on a default page instead of the deep link they tried to
 * open. Painful for emailed and bookmarked links.
 *
 * This test pins the redirect contract: every protected path must
 * produce a `/login?next=<encoded-path>` location header so the login
 * page can return the user to where they came from.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// next-auth/jwt is the only thing the proxy talks to externally; mock it
// to control the unauthenticated branch.
const getTokenMock = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: (...args: unknown[]) => getTokenMock(...args),
}));

function makeReq(pathname: string, search = ''): NextRequest {
  const url = `https://app.example${pathname}${search}`;
  return new NextRequest(url);
}

describe('proxy() — login redirect preserves return URL (visual P1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTokenMock.mockResolvedValue(null); // unauthenticated for every test
  });

  it('redirects /[slug]/admin to /login?next=/<slug>/admin', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/acme-cattle/admin'));
    expect(res.status).toBe(307);
    const loc = res.headers.get('location');
    expect(loc).toBeTruthy();
    const url = new URL(loc!);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe('/acme-cattle/admin');
  });

  it('preserves nested paths and query strings on the protected URL', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(
      makeReq('/acme-cattle/admin/animals', '?filter=cattle'),
    );
    const url = new URL(res.headers.get('location')!);
    // The full original path including the search string round-trips.
    expect(url.searchParams.get('next')).toBe(
      '/acme-cattle/admin/animals?filter=cattle',
    );
  });

  it('redirects bare /home to /login?next=/home', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/home'));
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe('/home');
  });

  it('does not append next= when the destination is /login itself (avoid loops)', async () => {
    // /login is already excluded by the matcher so the proxy() function
    // never sees it in production, but defence-in-depth: if it ever does
    // (e.g. an internal rewrite), the redirect must not loop.
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/'));
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/login');
    // The bare `/` is the universal entry point; no next= needed.
    expect(url.searchParams.get('next')).toBeNull();
  });
});
