import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FarmCreds } from '@/lib/meta-db';

type TaggedClient = { __tag: number };

// Track every PrismaClient instance so a test can distinguish "same cached
// client" from "fresh client after eviction".
const createdClients: TaggedClient[] = [];
let nextTag = 0;

const prismaCtor = vi.fn<() => TaggedClient>(() => {
  nextTag += 1;
  const instance = { __tag: nextTag };
  createdClients.push(instance);
  return instance;
});

const getFarmCredsMock = vi.fn<(slug: string) => Promise<FarmCreds | null>>(
  async (slug) => ({
    tursoUrl: `libsql://${slug}.example`,
    tursoAuthToken: `token-${slug}`,
    tier: 'advanced',
  }),
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
      return prismaCtor() as unknown as PrismaClientMock;
    }
  },
}));

vi.mock('@/lib/meta-db', () => ({
  getFarmCreds: getFarmCredsMock,
}));

// next/headers is not exercised by withFarmPrisma but the module imports it.
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => ({ get: () => null })),
}));

async function loadSubject() {
  const prismaMod = await import('@/lib/farm-prisma');
  const credsMod = await import('@/lib/farm-creds-cache');
  prismaMod.__clearFarmClientCache();
  credsMod.__clearFarmCredsCache();
  return prismaMod;
}

function resetSpies() {
  prismaCtor.mockClear();
  getFarmCredsMock.mockClear();
  createdClients.length = 0;
  nextTag = 0;
}

describe('withFarmPrisma', () => {
  beforeEach(async () => {
    resetSpies();
    await loadSubject();
  });

  it('runs the callback once on the happy path and caches the client', async () => {
    const { withFarmPrisma } = await loadSubject();
    const fn = vi.fn(async () => 'ok');

    const result = await withFarmPrisma('trio-b', fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(prismaCtor).toHaveBeenCalledTimes(1);
    expect(getFarmCredsMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached client on subsequent calls', async () => {
    const { withFarmPrisma } = await loadSubject();

    await withFarmPrisma('trio-b', async () => 'a');
    await withFarmPrisma('trio-b', async () => 'b');

    expect(prismaCtor).toHaveBeenCalledTimes(1);
    // Creds cache means we only hit meta-DB once per slug within TTL.
    expect(getFarmCredsMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on 401, evicting both client and creds cache', async () => {
    const { withFarmPrisma } = await loadSubject();

    const err = Object.assign(new Error('401 Unauthorized'), { code: 'SERVER_ERROR' });
    let calls = 0;
    const seenClients: TaggedClient[] = [];
    const fn = vi.fn<(p: TaggedClient) => Promise<string>>(async (client) => {
      seenClients.push(client);
      calls += 1;
      if (calls === 1) throw err;
      return 'recovered';
    });

    // Runtime mocks substitute TaggedClient for PrismaClient; the cast is
    // strictly for compilation.
    const result = await withFarmPrisma(
      'trio-b',
      fn as unknown as Parameters<typeof withFarmPrisma<string>>[1],
    );

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    // Retry rebuilt the client from scratch.
    expect(prismaCtor).toHaveBeenCalledTimes(2);
    // Retry re-read creds from meta (cache was evicted too).
    expect(getFarmCredsMock).toHaveBeenCalledTimes(2);
    // The two invocations received different client instances.
    expect(seenClients[0].__tag).not.toBe(seenClients[1].__tag);
  });

  it('does NOT retry on non-auth errors', async () => {
    const { withFarmPrisma } = await loadSubject();

    const err = new Error('P2002 unique constraint');
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(withFarmPrisma('trio-b', fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(prismaCtor).toHaveBeenCalledTimes(1);
  });

  it('propagates a second 401 without a third attempt', async () => {
    const { withFarmPrisma } = await loadSubject();

    const err = Object.assign(new Error('expired token'), { code: 'TOKEN_EXPIRED' });
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(withFarmPrisma('trio-b', fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws when the farm slug does not exist in meta-DB', async () => {
    const { withFarmPrisma } = await loadSubject();
    getFarmCredsMock.mockResolvedValueOnce(null);

    await expect(withFarmPrisma('unknown', async () => 'never')).rejects.toThrow(
      /farm "unknown" not found/,
    );
  });

  it('isolates caches per slug', async () => {
    const { withFarmPrisma } = await loadSubject();

    await withFarmPrisma('trio-b', async () => 'a');
    await withFarmPrisma('basson', async () => 'b');
    await withFarmPrisma('trio-b', async () => 'c');
    await withFarmPrisma('basson', async () => 'd');

    // One create per slug, reused.
    expect(prismaCtor).toHaveBeenCalledTimes(2);
    expect(getFarmCredsMock).toHaveBeenCalledTimes(2);
  });
});

describe('isTokenExpiredError', () => {
  it('matches libSQL auth shapes', async () => {
    const { isTokenExpiredError } = await import('@/lib/farm-prisma');
    expect(isTokenExpiredError({ code: 'SERVER_ERROR', message: '401 Unauthorized' })).toBe(true);
    expect(isTokenExpiredError({ code: 'TOKEN_EXPIRED' })).toBe(true);
    expect(isTokenExpiredError({ code: 'SQLITE_AUTH' })).toBe(true);
    expect(isTokenExpiredError({ message: 'token expired' })).toBe(true);
    expect(isTokenExpiredError({ message: 'invalid token' })).toBe(true);
  });

  it('rejects non-auth errors', async () => {
    const { isTokenExpiredError } = await import('@/lib/farm-prisma');
    expect(isTokenExpiredError(null)).toBe(false);
    expect(isTokenExpiredError({ code: 'SQLITE_BUSY' })).toBe(false);
    expect(isTokenExpiredError({ message: 'network unreachable' })).toBe(false);
  });
});
