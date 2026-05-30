/**
 * @vitest-environment node
 *
 * __tests__/api/observations/tenant-pin.test.ts — Issue #489 (PRD #479, Epic D,
 * #393 completion part 2).
 *
 * Pins the observations route family (list/create, edit, attachment, reset)
 * OFF `Referer`-derived tenant resolution. Two complementary locks:
 *
 *   1. Structural (matcher disposition) — every observations-family path MUST
 *      now match the `proxy.ts` matcher so the signed-header middleware runs
 *      and stamps the server-controlled `x-farm-slug` (HMAC over the active
 *      farm cookie). This is the load-bearing proof that the family no longer
 *      DEPENDS on the `Referer` header: when proxy runs, `getFarmContext`
 *      takes the signed fast path and never reaches the `slugFromReferer`
 *      branch in `lib/farm-prisma.ts`.
 *
 *   2. Behavioural (per-route) — invoking each route handler with a valid
 *      signed-header triplet resolves the tenant from the *signed slug*, with
 *      ZERO `Referer` read and ZERO `getServerSession` round-trip. A request
 *      with no signed headers AND a non-member session falls to the legacy
 *      membership gate and is rejected with the canonical 401 (AUTH_REQUIRED,
 *      per #486). Cross-tenant datasets stay disjoint: the slug handed to the
 *      Prisma acquire is always the signed one, never another tenant's.
 *
 * Mechanism choice (option (a) in the issue): bring the family under the
 * signed-header middleware, mirroring the dominant sibling pattern. The
 * cookie-scoped `/api/animals`, `/api/camps`, `/api/tasks` … routes use the
 * identical base `tenantRead`/`tenantWrite`/`adminWrite` adapters and are all
 * inside the matcher; `/api/observations` was the lone family excluded (a
 * March-2026 carve-out from before the signed-header hop existed, when the
 * matcher blindly 307'd un-authed POSTs to /login). No client caller changes
 * are required — every caller fires from inside the `/[farmSlug]/` shell where
 * proxy has already set `active_farm_slug`.
 *
 * We deliberately do NOT touch the `slugFromReferer` helper or the `Referer`
 * branch of `getPrismaForRequest` — that deletion is the gated follow-up #495.
 * This wave only stops the observations family from depending on it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SECRET = 'test-nextauth-secret';
process.env.NEXTAUTH_SECRET = SECRET;

// ── Mocks — boundary BELOW getFarmContext ───────────────────────────────────
// We exercise the REAL `getFarmContext` (signed fast path + legacy fallback)
// so the test proves tenant resolution end-to-end. The Prisma acquire and the
// legacy session pair are mocked at the `lib/farm-prisma` boundary, mirroring
// `__tests__/lib/server/farm-context.test.ts`.
const { prismaMock, getPrismaForFarmMock, getPrismaWithAuthMock, getServerSessionMock } =
  vi.hoisted(() => {
    const prisma = {
      observation: {
        create: vi.fn().mockResolvedValue({ id: 'obs-1', type: 'camp_check' }),
        upsert: vi.fn().mockResolvedValue({ id: 'obs-1', type: 'camp_check' }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ type: 'camp_check' }),
        update: vi.fn().mockResolvedValue({ id: 'obs-1', type: 'camp_check' }),
        delete: vi.fn().mockResolvedValue({ id: 'obs-1' }),
        deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      camp: { findFirst: vi.fn().mockResolvedValue({ campId: 'A' }) },
      animal: { findUnique: vi.fn().mockResolvedValue({ species: 'cattle' }) },
    };
    return {
      prismaMock: prisma,
      // Signed fast path resolves Prisma by the signed slug. Capture the slug
      // it was called with so we can assert the tenant came from the header.
      getPrismaForFarmMock: vi.fn(async () => prisma),
      // Legacy fallback (no signed headers) — non-member sessions must reject.
      getPrismaWithAuthMock: vi.fn(),
      getServerSessionMock: vi.fn(),
    };
  });

vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  getPrismaWithAuth: getPrismaWithAuthMock,
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));

// revalidatePath/Tag throw outside a request scope in Next 16.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 100 }),
}));

// adminWrite re-verifies a fresh ADMIN role against the meta DB (`@/lib/auth`)
// — stub only that one export true so the edit/reset routes reach their
// handler bodies under signed headers. Spread the real module so the other
// auth helpers keep their behaviour.
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, verifyFreshAdminRole: vi.fn().mockResolvedValue(true) };
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function signHeaders(
  slug: string,
  { userEmail = 'logger@farm.co.za', userId = 'user-1', role = 'ADMIN' } = {},
): Record<string, string> {
  const sig = createHmac('sha256', SECRET)
    .update(`v2\n${userEmail}\n${slug}\n${userId}\n${role}`)
    .digest('hex');
  return {
    'x-session-user': userEmail,
    'x-farm-slug': slug,
    'x-session-role': role,
    'x-session-sub': userId,
    'x-session-sig': sig,
    'Content-Type': 'application/json',
  };
}

function signedReq(
  url: string,
  slug: string,
  init: { method?: string; body?: unknown; referer?: string } = {},
): NextRequest {
  const headers = signHeaders(slug);
  // A DELIBERATELY HOSTILE Referer pointing at a DIFFERENT tenant. If any
  // route still resolved tenant from Referer, the signed-slug assertion below
  // would fail (the Prisma acquire would receive `evil-tenant`, not the signed
  // slug). This is the explicit "datasets stay disjoint" probe.
  headers['referer'] = init.referer ?? 'http://localhost/evil-tenant/logger';
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

beforeEach(() => {
  vi.resetModules();
  getPrismaForFarmMock.mockClear();
  getPrismaWithAuthMock.mockReset();
  getServerSessionMock.mockReset();
  // Default: no legacy session (so the no-signed-header path returns null/401
  // unless a test arranges otherwise).
  getServerSessionMock.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Structural — the whole family is now inside the proxy matcher
// ─────────────────────────────────────────────────────────────────────────────
describe('#489 — observations family is under the signed-header middleware', () => {
  let matcherRegex: RegExp;

  beforeEach(() => {
    const proxyPath = path.resolve(__dirname, '../../../proxy.ts');
    const src = fs.readFileSync(proxyPath, 'utf8');
    const match = src.match(/matcher\s*:\s*\[\s*["']([^"']+)["']/);
    if (!match) throw new Error('Could not extract config.matcher[0] from proxy.ts');
    const pattern = match[1].replace(/\\\\/g, '\\');
    matcherRegex = new RegExp('^' + pattern + '$');
  });

  it.each([
    ['list/create', '/api/observations'],
    ['edit/delete', '/api/observations/cm9obsid123'],
    ['attachment', '/api/observations/cm9obsid123/attachment'],
    ['reset', '/api/observations/reset'],
  ])(
    'proxy runs on the %s route (%s) so tenant comes from the signed cookie, not Referer',
    (_label, p) => {
      expect(matcherRegex.test(p)).toBe(true);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Behavioural — each route resolves tenant from the SIGNED slug
// ─────────────────────────────────────────────────────────────────────────────
describe('#489 — each route pins tenant to the signed slug (no Referer, no getServerSession)', () => {
  it('GET /api/observations resolves the signed slug', async () => {
    const { GET } = await import('@/app/api/observations/route');
    const req = signedReq('http://localhost/api/observations', 'tenant-a', { method: 'GET' });
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(getPrismaForFarmMock).toHaveBeenCalledWith('tenant-a');
    expect(getServerSessionMock).not.toHaveBeenCalled();
    expect(getPrismaWithAuthMock).not.toHaveBeenCalled();
  });

  it('POST /api/observations resolves the signed slug', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const req = signedReq('http://localhost/api/observations', 'tenant-a', {
      method: 'POST',
      body: { type: 'camp_check', camp_id: 'A' },
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(getPrismaForFarmMock).toHaveBeenCalledWith('tenant-a');
    expect(getServerSessionMock).not.toHaveBeenCalled();
    expect(getPrismaWithAuthMock).not.toHaveBeenCalled();
  });

  it('PATCH /api/observations/[id] resolves the signed slug', async () => {
    const { PATCH } = await import('@/app/api/observations/[id]/route');
    const req = signedReq('http://localhost/api/observations/obs-1', 'tenant-a', {
      method: 'PATCH',
      body: { details: '{"status":"healthy"}' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'obs-1' }) });
    expect(res.status).toBe(200);
    expect(getPrismaForFarmMock).toHaveBeenCalledWith('tenant-a');
    expect(getServerSessionMock).not.toHaveBeenCalled();
    expect(getPrismaWithAuthMock).not.toHaveBeenCalled();
  });

  it('DELETE /api/observations/[id] resolves the signed slug', async () => {
    const { DELETE } = await import('@/app/api/observations/[id]/route');
    const req = signedReq('http://localhost/api/observations/obs-1', 'tenant-a', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'obs-1' }) });
    expect(res.status).toBe(200);
    expect(getPrismaForFarmMock).toHaveBeenCalledWith('tenant-a');
    expect(getServerSessionMock).not.toHaveBeenCalled();
    expect(getPrismaWithAuthMock).not.toHaveBeenCalled();
  });

  it('PATCH /api/observations/[id]/attachment resolves the signed slug', async () => {
    const { PATCH } = await import('@/app/api/observations/[id]/attachment/route');
    const req = signedReq('http://localhost/api/observations/obs-1/attachment', 'tenant-a', {
      method: 'PATCH',
      body: { attachmentUrl: 'https://blob.example/photo.jpg' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'obs-1' }) });
    expect(res.status).toBe(200);
    expect(getPrismaForFarmMock).toHaveBeenCalledWith('tenant-a');
    expect(getServerSessionMock).not.toHaveBeenCalled();
    expect(getPrismaWithAuthMock).not.toHaveBeenCalled();
  });

  it('DELETE /api/observations/reset resolves the signed slug', async () => {
    const { DELETE } = await import('@/app/api/observations/reset/route');
    const req = signedReq('http://localhost/api/observations/reset', 'tenant-a', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(getPrismaForFarmMock).toHaveBeenCalledWith('tenant-a');
    expect(getServerSessionMock).not.toHaveBeenCalled();
    expect(getPrismaWithAuthMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Membership gate — non-member slug → canonical 401, datasets disjoint
// ─────────────────────────────────────────────────────────────────────────────
describe('#489 — membership gate preserved (defense-in-depth): non-member → 401', () => {
  // No signed headers (a direct fetch bypassing the proxy) AND a session that
  // is NOT a member of the requested farm. The legacy fallback inside
  // `getFarmContext` calls `getPrismaWithAuth`, which returns a Forbidden
  // error object → `getFarmContext` maps to null → the adapter mints the
  // canonical AUTH_REQUIRED 401. The non-member tenant's Prisma client is
  // NEVER acquired, so datasets stay disjoint.
  beforeEach(() => {
    getServerSessionMock.mockResolvedValue({
      user: { id: 'user-1', email: 'logger@farm.co.za', farms: [{ slug: 'tenant-a', role: 'ADMIN' }] },
    });
    // Non-member: the cookie/Referer pointed at a farm the user does not belong
    // to → getPrismaWithAuth rejects.
    getPrismaWithAuthMock.mockResolvedValue({ error: 'Forbidden', status: 403 });
  });

  // The route handlers carry varying `RouteHandler<TParams>` param types
  // (`{}`, `{ id }`); the test only fires them with a request + params bag, so
  // we erase the param specificity to the base `RouteHandler` shape.
  type AnyRouteHandler = (
    req: NextRequest,
    ctx: { params: Promise<Record<string, string>> },
  ) => Promise<Response>;

  async function expect401(
    importer: () => Promise<{ handler: AnyRouteHandler }>,
    url: string,
    init: { method: string; body?: unknown; params?: Record<string, string> },
  ) {
    const { handler } = await importer();
    const req = new NextRequest(url, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', referer: 'http://localhost/not-my-tenant/logger' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const res = await handler(req, { params: Promise.resolve(init.params ?? {}) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('AUTH_REQUIRED');
    // The non-member tenant's client was never acquired.
    expect(getPrismaForFarmMock).not.toHaveBeenCalled();
  }

  it('GET /api/observations → 401 for a non-member', async () => {
    await expect401(
      async () => ({ handler: (await import('@/app/api/observations/route')).GET }),
      'http://localhost/api/observations',
      { method: 'GET' },
    );
  });

  it('POST /api/observations → 401 for a non-member', async () => {
    await expect401(
      async () => ({ handler: (await import('@/app/api/observations/route')).POST }),
      'http://localhost/api/observations',
      { method: 'POST', body: { type: 'camp_check', camp_id: 'A' } },
    );
  });

  it('PATCH /api/observations/[id] → 401 for a non-member', async () => {
    await expect401(
      async () => ({
        handler: (await import('@/app/api/observations/[id]/route')).PATCH as AnyRouteHandler,
      }),
      'http://localhost/api/observations/obs-1',
      { method: 'PATCH', body: { details: '{}' }, params: { id: 'obs-1' } },
    );
  });

  it('DELETE /api/observations/[id] → 401 for a non-member', async () => {
    await expect401(
      async () => ({
        handler: (await import('@/app/api/observations/[id]/route')).DELETE as AnyRouteHandler,
      }),
      'http://localhost/api/observations/obs-1',
      { method: 'DELETE', params: { id: 'obs-1' } },
    );
  });

  it('PATCH /api/observations/[id]/attachment → 401 for a non-member', async () => {
    await expect401(
      async () => ({
        handler: (await import('@/app/api/observations/[id]/attachment/route'))
          .PATCH as AnyRouteHandler,
      }),
      'http://localhost/api/observations/obs-1/attachment',
      { method: 'PATCH', body: { attachmentUrl: 'https://blob.example/x.jpg' }, params: { id: 'obs-1' } },
    );
  });

  it('DELETE /api/observations/reset → 401 for a non-member', async () => {
    await expect401(
      async () => ({ handler: (await import('@/app/api/observations/reset/route')).DELETE }),
      'http://localhost/api/observations/reset',
      { method: 'DELETE' },
    );
  });
});
