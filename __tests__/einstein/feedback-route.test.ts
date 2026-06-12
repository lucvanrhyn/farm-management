/**
 * @vitest-environment node
 *
 * __tests__/einstein/feedback-route.test.ts — Epic D1 (#488).
 *
 * POST /api/einstein/feedback now pins the tenant via an EXPLICIT body slug
 * resolved through `getPrismaForSlugWithAuth` (the session-membership gate),
 * mirroring the sibling /api/einstein/ask route. This removes the route's
 * reliance on `Referer`-header inference (`getFarmContext` → legacy
 * `slugFromReferer`), the un-migrated remainder of #393.
 *
 * Covered behaviours:
 *   1. Unauth session → 401 EINSTEIN_UNAUTHENTICATED.
 *   2. Bad body (not JSON / missing queryLogId / missing farmSlug / bad
 *      feedback value) → 400 EINSTEIN_BAD_REQUEST.
 *   3. Farm not in meta DB → 404 EINSTEIN_FARM_NOT_FOUND.
 *   4. Basic tier → 403 EINSTEIN_TIER_LOCKED.
 *   5. Non-member / unknown slug → 403 EINSTEIN_FORBIDDEN (membership gate;
 *      the body slug is validated against session.user.farms — a foreign slug
 *      cannot select another tenant).
 *   6. Member slug → 200; ragQueryLog.update invoked on the slug-resolved
 *      Prisma client. Tenant resolution does NOT consult the Referer header.
 *   7. Prisma P2025 → 404 EINSTEIN_FEEDBACK_NOT_FOUND.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Session mock ──────────────────────────────────────────────────────────────
const mockGetServerSession = vi.fn();
vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock('next-auth/providers/credentials', () => ({
  default: () => ({ id: 'credentials' }),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

// ── Meta DB / tier ────────────────────────────────────────────────────────────
const mockGetFarmCreds = vi.fn();
vi.mock('@/lib/meta-db', () => ({
  getFarmCreds: (...args: unknown[]) => mockGetFarmCreds(...args),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockRagQueryLogUpdate = vi.fn();

const mockPrisma = {
  ragQueryLog: {
    update: mockRagQueryLogUpdate,
  },
};

// `getPrismaForSlugWithAuth` is the slug-aware, membership-gated resolver. The
// route MUST resolve the tenant through this (and pass the body slug), never
// through a Referer-derived helper.
const mockGetPrismaForSlugWithAuth = vi.fn();
const mockGetPrismaForFarm = vi.fn();
vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForSlugWithAuth: (...args: unknown[]) =>
    mockGetPrismaForSlugWithAuth(...args),
  getPrismaForFarm: (...args: unknown[]) => mockGetPrismaForFarm(...args),
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// Import AFTER every vi.mock so the handler picks up the doubles.
const { POST } = await import('@/app/api/einstein/feedback/route');

// Wave H3 (#175) — POST is wrapped in `publicHandler`, so its signature is
// `(req, ctx)`. The adapter tolerates an empty params context.
const CTX = { params: Promise.resolve({}) };

// ── Helpers ───────────────────────────────────────────────────────────────────

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/einstein/feedback', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const validSession = {
  user: {
    id: 'user-1',
    email: 'farmer@example.com',
    farms: [{ slug: 'delta-livestock', role: 'farm_admin' }],
  },
};

const advancedCreds = {
  tursoUrl: 'libsql://x',
  tursoAuthToken: 'tkn',
  tier: 'advanced',
};
const basicCreds = { ...advancedCreds, tier: 'basic' };

function resetAll() {
  mockGetServerSession.mockReset();
  mockGetFarmCreds.mockReset();
  mockGetPrismaForSlugWithAuth.mockReset();
  mockGetPrismaForFarm.mockReset();
  mockRagQueryLogUpdate.mockReset();
}

function happyPathDefaults() {
  mockGetServerSession.mockResolvedValue(validSession);
  mockGetFarmCreds.mockResolvedValue(advancedCreds);
  mockGetPrismaForSlugWithAuth.mockResolvedValue({
    prisma: mockPrisma,
    slug: 'delta-livestock',
    role: 'farm_admin',
  });
  mockRagQueryLogUpdate.mockResolvedValue({ id: 'log-1' });
}

beforeEach(() => resetAll());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/einstein/feedback — auth + validation', () => {
  it('returns the canonical AUTH_REQUIRED 401 envelope when session is missing', async () => {
    // Issue #493 (Epic B) — the session-missing arm folds onto the canonical
    // ADR-0001 `{ error: "AUTH_REQUIRED", message: "Unauthorized" }` envelope,
    // mirroring the identical fold the sibling `/api/einstein/ask` route
    // shipped in #486. The legacy `{ code: "EINSTEIN_UNAUTHENTICATED" }` shape
    // is gone; the only consumer (EinsteinChat thumbs-up/down) is
    // fire-and-forget and never reads this body.
    mockGetServerSession.mockResolvedValue(null);
    const resp = await POST(
      createRequest({ queryLogId: 'log-1', feedback: 'up', farmSlug: 'delta-livestock' }),
      CTX,
    );
    expect(resp.status).toBe(401);
    const json = await resp.json();
    expect(json).toEqual({ error: 'AUTH_REQUIRED', message: 'Unauthorized' });
    expect(json.code).toBeUndefined();
  });

  it('returns 400 EINSTEIN_BAD_REQUEST when body is not valid JSON', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    const resp = await POST(createRequest('{not valid json'), CTX);
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_BAD_REQUEST');
  });

  it('returns 400 when queryLogId is missing', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    const resp = await POST(
      createRequest({ feedback: 'up', farmSlug: 'delta-livestock' }),
      CTX,
    );
    expect(resp.status).toBe(400);
  });

  it('returns 400 when farmSlug is missing', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    const resp = await POST(
      createRequest({ queryLogId: 'log-1', feedback: 'up' }),
      CTX,
    );
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_BAD_REQUEST');
  });

  it('returns 400 for an invalid feedback value', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    const resp = await POST(
      createRequest({ queryLogId: 'log-1', feedback: 'sideways', farmSlug: 'delta-livestock' }),
      CTX,
    );
    expect(resp.status).toBe(400);
  });
});

describe('POST /api/einstein/feedback — tier gate', () => {
  it('returns 404 EINSTEIN_FARM_NOT_FOUND when meta DB has no creds', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetFarmCreds.mockResolvedValue(null);
    const resp = await POST(
      createRequest({ queryLogId: 'log-1', feedback: 'up', farmSlug: 'ghost' }),
      CTX,
    );
    expect(resp.status).toBe(404);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_FARM_NOT_FOUND');
  });

  it('returns 403 EINSTEIN_TIER_LOCKED for basic tier', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetFarmCreds.mockResolvedValue(basicCreds);
    const resp = await POST(
      createRequest({ queryLogId: 'log-1', feedback: 'up', farmSlug: 'delta-livestock' }),
      CTX,
    );
    expect(resp.status).toBe(403);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_TIER_LOCKED');
  });
});

describe('POST /api/einstein/feedback — tenant isolation (membership gate)', () => {
  it('rejects a non-member / foreign slug with 403 EINSTEIN_FORBIDDEN', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetFarmCreds.mockResolvedValue(advancedCreds);
    // getPrismaForSlugWithAuth rejects: the body slug is not in session farms.
    mockGetPrismaForSlugWithAuth.mockResolvedValue({
      error: 'Forbidden',
      status: 403,
    });

    const resp = await POST(
      createRequest({ queryLogId: 'log-1', feedback: 'up', farmSlug: 'other-tenant' }),
      CTX,
    );
    expect(resp.status).toBe(403);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_FORBIDDEN');
    // The foreign slug never reached a tenant Prisma client.
    expect(mockRagQueryLogUpdate).not.toHaveBeenCalled();
  });

  it('passes the BODY slug (not a Referer-derived one) to getPrismaForSlugWithAuth', async () => {
    happyPathDefaults();
    await POST(
      createRequest({ queryLogId: 'log-1', feedback: 'down', farmSlug: 'delta-livestock' }),
      CTX,
    );
    expect(mockGetPrismaForSlugWithAuth).toHaveBeenCalledTimes(1);
    const [, slugArg] = mockGetPrismaForSlugWithAuth.mock.calls[0];
    expect(slugArg).toBe('delta-livestock');
  });

  it('resolves the tenant WITHOUT consulting the Referer header', async () => {
    happyPathDefaults();
    // A Referer pointing at a DIFFERENT farm must not influence resolution —
    // the explicit body slug is authoritative.
    const req = new NextRequest('http://localhost/api/einstein/feedback', {
      method: 'POST',
      body: JSON.stringify({
        queryLogId: 'log-1',
        feedback: 'up',
        farmSlug: 'delta-livestock',
      }),
      headers: {
        'Content-Type': 'application/json',
        Referer: 'http://localhost/some-other-farm/einstein',
      },
    });
    const resp = await POST(req, CTX);
    expect(resp.status).toBe(200);
    const [, slugArg] = mockGetPrismaForSlugWithAuth.mock.calls[0];
    expect(slugArg).toBe('delta-livestock');
  });
});

describe('POST /api/einstein/feedback — happy path', () => {
  it('returns 200 and updates ragQueryLog on the slug-resolved Prisma client', async () => {
    happyPathDefaults();
    const resp = await POST(
      createRequest({
        queryLogId: 'log-1',
        feedback: 'up',
        note: 'Spot on',
        farmSlug: 'delta-livestock',
      }),
      CTX,
    );
    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.success).toBe(true);
    expect(json.id).toBe('log-1');

    expect(mockRagQueryLogUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockRagQueryLogUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { feedback: string; feedbackNote: string | null };
    };
    expect(updateArgs.where.id).toBe('log-1');
    expect(updateArgs.data.feedback).toBe('up');
    expect(updateArgs.data.feedbackNote).toBe('Spot on');
  });

  it('maps Prisma P2025 to 404 EINSTEIN_FEEDBACK_NOT_FOUND', async () => {
    happyPathDefaults();
    mockRagQueryLogUpdate.mockRejectedValue({ code: 'P2025', message: 'Record not found' });
    const resp = await POST(
      createRequest({ queryLogId: 'nope', feedback: 'down', farmSlug: 'delta-livestock' }),
      CTX,
    );
    expect(resp.status).toBe(404);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_FEEDBACK_NOT_FOUND');
  });
});

// ── api-M1 (S27) — Prisma/DB error text must NEVER reach the client ──────────
//
// The pre-fix catch arm echoed `err.message` verbatim into the response body
// for every `Error` instance (`jsonError(code, err.message, status)`), so a
// raw Prisma message — which carries internal schema text (table/column/
// payload) — leaked to authenticated clients on both the P2025 → 404 arm and
// the generic 500 arm. Contract now: the P2025 arm keeps its typed 404 with a
// STATIC message; every other throw is rethrown to the `publicHandler`
// wrapper, which routes it through `mapApiDomainError` (#483) → the opaque
// `DB_QUERY_FAILED` envelope, with the full error preserved server-side.
describe('POST /api/einstein/feedback — Prisma/DB error sanitization (api-M1)', () => {
  /** Error shaped like a real Prisma exception: name + code + leaky message. */
  function makePrismaError(name: string, message: string, code?: string): Error {
    const err = new Error(message) as Error & { code?: string };
    err.name = name;
    if (code !== undefined) err.code = code;
    return err;
  }

  const FEEDBACK_BODY = {
    queryLogId: 'log-1',
    feedback: 'down',
    farmSlug: 'delta-livestock',
  };

  it('does NOT echo the raw Prisma message on the P2025 → 404 arm', async () => {
    happyPathDefaults();
    const leak =
      'An operation failed because it depends on one or more records that were required but not found. No `RagQueryLog` record (column `secret_col`) was found.';
    mockRagQueryLogUpdate.mockRejectedValue(
      makePrismaError('PrismaClientKnownRequestError', leak, 'P2025'),
    );
    const resp = await POST(createRequest(FEEDBACK_BODY), CTX);
    expect(resp.status).toBe(404);
    const text = await resp.text();
    expect(JSON.parse(text).code).toBe('EINSTEIN_FEEDBACK_NOT_FOUND');
    expect(text).not.toContain('RagQueryLog');
    expect(text).not.toContain('secret_col');
  });

  it('collapses a non-P2025 Prisma error to the opaque DB_QUERY_FAILED envelope', async () => {
    happyPathDefaults();
    const { logger } = await import('@/lib/logger');
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const leak =
        'Unique constraint failed on the fields: (`feedbackNote`) on table `RagQueryLog`';
      mockRagQueryLogUpdate.mockRejectedValue(
        makePrismaError('PrismaClientKnownRequestError', leak, 'P2002'),
      );
      const resp = await POST(createRequest(FEEDBACK_BODY), CTX);
      expect(resp.status).toBe(500);
      const text = await resp.text();
      expect(JSON.parse(text)).toEqual({ error: 'DB_QUERY_FAILED' });
      expect(text).not.toContain('RagQueryLog');
      expect(text).not.toContain('feedbackNote');
      // The full error is preserved server-side (mapApiDomainError logs it).
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('sanitizes a generic unexpected throw (no raw message echo)', async () => {
    happyPathDefaults();
    const { logger } = await import('@/lib/logger');
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      mockRagQueryLogUpdate.mockRejectedValue(
        new Error('connect ECONNREFUSED 10.0.0.5:5432 (tenant libsql url)'),
      );
      const resp = await POST(createRequest(FEEDBACK_BODY), CTX);
      expect(resp.status).toBe(500);
      const text = await resp.text();
      expect(JSON.parse(text)).toEqual({ error: 'DB_QUERY_FAILED' });
      expect(text).not.toContain('ECONNREFUSED');
      expect(text).not.toContain('libsql');
      // publicHandler logs the unexpected throw server-side.
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
