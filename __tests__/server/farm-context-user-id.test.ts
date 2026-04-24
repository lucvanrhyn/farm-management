/**
 * @vitest-environment node
 *
 * Phase G (P6.5) — end-to-end user-id propagation.
 *
 * Proxy.ts signs (email, slug, sub) → HMAC. farm-context.ts verifies the
 * HMAC and synthesises `session.user.id` from `sub`. Every migrated
 * admin-write handler relies on this round-trip to call
 * `verifyFreshAdminRole(session.user.id, slug)`; if the propagation breaks
 * (empty-string id), every ADMIN is silently rejected.
 *
 * This test wires proxy → farm-context through their real HMAC + reads
 * the `session.user.id` that falls out. No mocks in the middle — only
 * Prisma/meta-db/getServerSession at the edges.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'test-nextauth-secret';
process.env.NEXTAUTH_SECRET = SECRET;

const getTokenMock = vi.fn();
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }));

const getPrismaForFarmMock = vi.fn();
vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  getPrismaWithAuth: vi.fn(),
  getPrismaForSlugWithAuth: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));

describe('proxy → farm-context user.id round-trip', () => {
  beforeEach(() => {
    vi.resetModules();
    getTokenMock.mockReset();
    getPrismaForFarmMock.mockReset();
  });

  it('proxy.ts signs token.sub and farm-context.ts exposes it as session.user.id', async () => {
    getTokenMock.mockResolvedValue({
      sub: 'user-42',
      email: 'alice@example.com',
      farms: [
        {
          slug: 'trio-b',
          tier: 'advanced',
          subscriptionStatus: 'active',
          role: 'ADMIN',
          displayName: 'Trio B',
          logoUrl: null,
        },
      ],
    });

    // Run proxy.ts against a request the middleware matcher would hit.
    const { proxy } = await import('@/proxy');
    const headers = new Headers();
    headers.set('cookie', 'active_farm_slug=trio-b');
    const proxyReq = new NextRequest('http://localhost/api/tasks', { headers });

    const proxyRes = await proxy(proxyReq);

    // Extract the stamped headers from the middleware response. Next.js
    // copies overrides into `x-middleware-request-<name>`.
    const get = (name: string) =>
      proxyRes.headers.get(`x-middleware-request-${name}`) ?? '';
    const downstream = new Headers();
    for (const name of [
      'x-session-user',
      'x-farm-slug',
      'x-session-role',
      'x-session-sub',
      'x-session-sig',
    ]) {
      const v = get(name);
      if (v) downstream.set(name, v);
    }

    expect(downstream.get('x-session-sub')).toBe('user-42');

    // Now simulate the handler receiving the forwarded request.
    getPrismaForFarmMock.mockResolvedValue({ marker: 'farm-b-prisma' });
    const downstreamReq = new NextRequest('http://localhost/api/tasks', {
      headers: downstream,
    });
    const { getFarmContext } = await import('@/lib/server/farm-context');
    const ctx = await getFarmContext(downstreamReq);

    expect(ctx).not.toBeNull();
    // CRITICAL: verifyFreshAdminRole(session.user.id, slug) would otherwise
    // silently reject every ADMIN. The round-trip must preserve the id.
    expect(ctx!.session.user.id).toBe('user-42');
    expect(ctx!.session.user.email).toBe('alice@example.com');
    expect(ctx!.slug).toBe('trio-b');
    expect(ctx!.role).toBe('ADMIN');
  });

  it('spoofed x-session-sub without a valid signature is rejected → falls back', async () => {
    // No token, no fast path possible, but attacker sends forged headers.
    // The HMAC will not verify → helper falls back to getServerSession
    // which we've mocked to return null.
    getPrismaForFarmMock.mockResolvedValue({ marker: 'should-not-be-used' });

    const headers = new Headers();
    headers.set('x-session-user', 'attacker@example.com');
    headers.set('x-farm-slug', 'trio-b');
    headers.set('x-session-role', 'ADMIN');
    headers.set('x-session-sub', 'user-admin-id');
    // Wrong signature.
    headers.set('x-session-sig', 'a'.repeat(64));

    const req = new NextRequest('http://localhost/api/tasks', { headers });

    const { getFarmContext } = await import('@/lib/server/farm-context');
    const ctx = await getFarmContext(req);

    // getServerSession returns null → helper returns null → handler will
    // respond 401. Fast path MUST NOT trust the forged headers.
    expect(ctx).toBeNull();
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
  });
});
