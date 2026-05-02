/**
 * @vitest-environment node
 *
 * Wave 4 A5 — getFarmContext returns a Prisma client wrapped with one-shot
 * Turso auth-expiry retry. Codex (2026-05-02) HIGH finding: the existing
 * `withFarmPrisma` retry boundary covered ~5% of routes; the other ~95%
 * called `ctx.prisma.<model>.<op>(...)` directly and 500'd on the first
 * cached-token expiry until the next cold-start.
 *
 * Cases covered:
 *   (a) Happy path: successful query → callback runs once, no retry.
 *   (b) First call throws auth error → cached client + creds evicted, fresh
 *       client built, second call succeeds.
 *   (c) Second call also throws auth → error propagated, no third attempt.
 *   (d) Non-auth error → not retried.
 *   (e) `$transaction` / `$queryRawUnsafe` / `$executeRawUnsafe` go through
 *       the same retry boundary.
 *   (f) After a successful retry, the wrapper resolves to the FRESH client
 *       on subsequent calls (no stale-instance reuse — see
 *       feedback-vercel-cached-prisma-client.md).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import type { FarmCreds } from '@/lib/meta-db';

const SECRET = 'test-nextauth-secret';
process.env.NEXTAUTH_SECRET = SECRET;

// ── Hoisted mock state ────────────────────────────────────────────────────
// vi.mock factories execute during module init; bare top-level state lands
// in TDZ. See feedback-vi-hoisted-shared-mocks.md.
const hoisted = vi.hoisted(() => {
  type ModelCall = (...args: unknown[]) => Promise<unknown>;
  type ClientStub = {
    __tag: number;
    animal: { findMany: ModelCall; findUnique: ModelCall };
    observation: { create: ModelCall };
    $transaction: ModelCall;
    $queryRawUnsafe: ModelCall;
    $executeRawUnsafe: ModelCall;
  };

  const created: ClientStub[] = [];
  // Per-test mutable counter — reset by each test via `resetState()` so tag
  // numbers always start at 1 (matches the handler scripts each test sets up).
  const counter = { next: 0 };

  // Per-tag handler scripts so a test can program "instance #1 throws auth,
  // instance #2 succeeds".
  const handlers = new Map<number, Partial<Record<string, ModelCall>>>();

  function makeStub(): ClientStub {
    counter.next += 1;
    const tag = counter.next;
    const wrap = (key: string): ModelCall => async (...args) => {
      const handler = handlers.get(tag)?.[key];
      if (!handler) {
        throw new Error(`tag=${tag} no handler for ${key}`);
      }
      return handler(...args);
    };
    const stub: ClientStub = {
      __tag: tag,
      animal: { findMany: wrap('animal.findMany'), findUnique: wrap('animal.findUnique') },
      observation: { create: wrap('observation.create') },
      $transaction: wrap('$transaction'),
      $queryRawUnsafe: wrap('$queryRawUnsafe'),
      $executeRawUnsafe: wrap('$executeRawUnsafe'),
    };
    created.push(stub);
    return stub;
  }

  function resetState() {
    created.length = 0;
    counter.next = 0;
    handlers.clear();
  }

  return { created, handlers, counter, makeStub, resetState, prismaCtor: vi.fn(makeStub) };
});

const getFarmCredsMock = vi.hoisted(() =>
  vi.fn<(slug: string) => Promise<FarmCreds | null>>(async (slug) => ({
    tursoUrl: `libsql://${slug}.example`,
    tursoAuthToken: `token-${slug}`,
    tier: 'advanced',
  })),
);

vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => ({ execute: vi.fn() })),
}));

vi.mock('@prisma/adapter-libsql', () => ({
  PrismaLibSQL: class PrismaLibSQLMock {},
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClientMock {
    constructor() {
      return hoisted.prismaCtor() as unknown as PrismaClientMock;
    }
  },
}));

vi.mock('@/lib/meta-db', () => ({
  getFarmCreds: getFarmCredsMock,
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));

// ── Helpers ───────────────────────────────────────────────────────────────
function sign(email: string, slug: string, sub: string, role: string): string {
  return createHmac('sha256', SECRET)
    .update(`v2\n${email}\n${slug}\n${sub}\n${role}`)
    .digest('hex');
}

function makeReq(slug: string): NextRequest {
  const email = 'tester@example.com';
  const sub = 'user-1';
  const role = 'ADMIN';
  const sig = sign(email, slug, sub, role);
  const headers = new Headers();
  headers.set('x-session-user', email);
  headers.set('x-farm-slug', slug);
  headers.set('x-session-role', role);
  headers.set('x-session-sub', sub);
  headers.set('x-session-sig', sig);
  return new NextRequest(`http://localhost/api/observations?slug=${slug}`, { headers });
}

async function loadFresh() {
  vi.resetModules();
  const credsMod = await import('@/lib/farm-creds-cache');
  const prismaMod = await import('@/lib/farm-prisma');
  prismaMod.__clearFarmClientCache();
  credsMod.__clearFarmCredsCache();
  hoisted.prismaCtor.mockClear();
  getFarmCredsMock.mockClear();
  hoisted.resetState();
  const ctxMod = await import('@/lib/server/farm-context');
  return { ctxMod, prismaMod };
}

function authError(): Error {
  return Object.assign(new Error('401 Unauthorized'), { code: 'SERVER_ERROR' });
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe('getFarmContext — Prisma auth-retry on the main path', () => {
  beforeEach(() => {
    // Each test reloads the module graph so the global PrismaClient cache
    // doesn't leak from a previous case.
  });

  it('(a) happy path: model call resolves on first try, no retry', async () => {
    const { ctxMod } = await loadFresh();
    hoisted.handlers.set(1, {
      'animal.findMany': async () => [{ id: 'a-1' }],
    });

    const ctx = await ctxMod.getFarmContext(makeReq('trio-b'));
    expect(ctx).not.toBeNull();
    const result = await ctx!.prisma.animal.findMany();

    expect(result).toEqual([{ id: 'a-1' }]);
    expect(hoisted.prismaCtor).toHaveBeenCalledTimes(1);
    expect(getFarmCredsMock).toHaveBeenCalledTimes(1);
    expect(hoisted.created).toHaveLength(1);
  });

  it('(b) first call throws token-expired → fresh client built and retry succeeds', async () => {
    const { ctxMod } = await loadFresh();
    // Tag #1 throws once; tag #2 (the rebuild) succeeds.
    hoisted.handlers.set(1, {
      'animal.findMany': async () => {
        throw authError();
      },
    });
    hoisted.handlers.set(2, {
      'animal.findMany': async () => [{ id: 'recovered' }],
    });

    const ctx = await ctxMod.getFarmContext(makeReq('trio-b'));
    const result = await ctx!.prisma.animal.findMany();

    expect(result).toEqual([{ id: 'recovered' }]);
    // Two PrismaClient constructions: original + rebuild.
    expect(hoisted.prismaCtor).toHaveBeenCalledTimes(2);
    // Two creds reads: original + post-eviction rebuild.
    expect(getFarmCredsMock).toHaveBeenCalledTimes(2);
  });

  it('(c) retry also throws auth error → propagated, no third attempt', async () => {
    const { ctxMod } = await loadFresh();
    hoisted.handlers.set(1, {
      'animal.findMany': async () => {
        throw authError();
      },
    });
    hoisted.handlers.set(2, {
      'animal.findMany': async () => {
        throw authError();
      },
    });

    const ctx = await ctxMod.getFarmContext(makeReq('trio-b'));
    await expect(ctx!.prisma.animal.findMany()).rejects.toMatchObject({
      message: '401 Unauthorized',
    });

    expect(hoisted.prismaCtor).toHaveBeenCalledTimes(2);
  });

  it('(d) non-auth error is propagated without retry', async () => {
    const { ctxMod } = await loadFresh();
    const businessError = new Error('P2002 unique constraint');
    hoisted.handlers.set(1, {
      'observation.create': async () => {
        throw businessError;
      },
    });

    const ctx = await ctxMod.getFarmContext(makeReq('trio-b'));
    await expect(ctx!.prisma.observation.create({ data: {} })).rejects.toBe(businessError);

    expect(hoisted.prismaCtor).toHaveBeenCalledTimes(1);
  });

  it('(e) $transaction / $queryRawUnsafe / $executeRawUnsafe are wrapped too', async () => {
    const { ctxMod } = await loadFresh();
    let txCalls = 0;
    hoisted.handlers.set(1, {
      $transaction: async () => {
        txCalls += 1;
        throw authError();
      },
      // $queryRawUnsafe and $executeRawUnsafe deliberately NOT scripted on
      // tag 1 — they should never run against the original client because
      // the first call ($transaction) triggers the retry which rebuilds the
      // cache. Subsequent calls in this test hit tag #2.
    });
    hoisted.handlers.set(2, {
      $transaction: async () => 'tx-ok',
      $queryRawUnsafe: async () => [{ value: 1 }],
      $executeRawUnsafe: async () => 1,
    });

    const ctx = await ctxMod.getFarmContext(makeReq('trio-b'));

    await expect(ctx!.prisma.$transaction([])).resolves.toBe('tx-ok');
    expect(txCalls).toBe(1);

    // After the retry, the cached client has been rebuilt, so the next call
    // hits the fresh client (#2) directly with no further error. The query
    // should resolve immediately, no third construction needed.
    await expect(ctx!.prisma.$queryRawUnsafe('SELECT 1')).resolves.toEqual([{ value: 1 }]);
    await expect(ctx!.prisma.$executeRawUnsafe('UPDATE x')).resolves.toBe(1);
    expect(hoisted.prismaCtor).toHaveBeenCalledTimes(2);
  });

  it('(f) after retry, subsequent calls reuse the FRESH client (no stale instance)', async () => {
    const { ctxMod } = await loadFresh();
    hoisted.handlers.set(1, {
      'animal.findMany': async () => {
        throw authError();
      },
    });
    hoisted.handlers.set(2, {
      'animal.findMany': async () => [{ tag: 2 }],
    });

    const ctx = await ctxMod.getFarmContext(makeReq('trio-b'));

    // Trigger the retry once.
    const r1 = await ctx!.prisma.animal.findMany();
    expect(r1).toEqual([{ tag: 2 }]);

    // Second call: must NOT rebuild a third client. The cache now holds
    // tag #2 (fresh). If the wrapper held a closure over the original
    // (evicted) client, it would either re-throw the auth error or
    // construct a third client.
    const r2 = await ctx!.prisma.animal.findMany();
    expect(r2).toEqual([{ tag: 2 }]);
    expect(hoisted.prismaCtor).toHaveBeenCalledTimes(2);
  });
});
