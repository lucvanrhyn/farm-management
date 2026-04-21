import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture every createClient call so the test can distinguish
// "same cached client" from "fresh client after eviction".
const createdClients: Array<{ execute: ReturnType<typeof vi.fn> }> = [];
const createClientSpy = vi.fn(() => {
  const client = { execute: vi.fn() };
  createdClients.push(client);
  return client;
});

vi.mock('@libsql/client', () => ({
  createClient: createClientSpy,
}));

process.env.META_TURSO_URL = 'libsql://test.example';
process.env.META_TURSO_AUTH_TOKEN = 'token';

async function loadSubject() {
  const mod = await import('@/lib/meta-db');
  mod.__resetMetaClient();
  return mod;
}

function resetSpies() {
  createClientSpy.mockClear();
  createdClients.length = 0;
}

describe('withMetaDb', () => {
  beforeEach(async () => {
    resetSpies();
    const mod = await import('@/lib/meta-db');
    mod.__resetMetaClient();
  });

  it('returns the callback result on the happy path without retry', async () => {
    const { withMetaDb } = await loadSubject();
    const fn = vi.fn(async () => 'ok');

    const result = await withMetaDb(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(createClientSpy).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached client across calls on the happy path', async () => {
    const { withMetaDb } = await loadSubject();

    await withMetaDb(async () => 'first');
    await withMetaDb(async () => 'second');

    expect(createClientSpy).toHaveBeenCalledTimes(1);
  });

  it('retries once on 401 and evicts the cached client', async () => {
    const { withMetaDb } = await loadSubject();

    const err = Object.assign(new Error('401 Unauthorized'), { code: 'SERVER_ERROR' });
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw err;
      return 'recovered';
    });

    const result = await withMetaDb(fn);

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    // Eviction forces createClient to be called a second time on retry.
    expect(createClientSpy).toHaveBeenCalledTimes(2);
    // The two calls received different client instances.
    expect(createdClients).toHaveLength(2);
  });

  it('retries on TOKEN_EXPIRED code regardless of message', async () => {
    const { withMetaDb } = await loadSubject();

    const err = Object.assign(new Error('generic'), { code: 'TOKEN_EXPIRED' });
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw err;
      return 'recovered';
    });

    await expect(withMetaDb(fn)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on non-auth errors', async () => {
    const { withMetaDb } = await loadSubject();

    const err = new Error('constraint violation');
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(withMetaDb(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(createClientSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates a second 401 without a third attempt', async () => {
    const { withMetaDb } = await loadSubject();

    const err = Object.assign(new Error('401 Unauthorized'), { code: 'SERVER_ERROR' });
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(withMetaDb(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('isMetaAuthError', () => {
  it('matches a variety of libSQL auth shapes', async () => {
    const { isMetaAuthError } = await loadSubject();
    expect(isMetaAuthError({ code: 'SERVER_ERROR', message: '401 Unauthorized' })).toBe(true);
    expect(isMetaAuthError({ code: 'TOKEN_EXPIRED' })).toBe(true);
    expect(isMetaAuthError({ code: 'SQLITE_AUTH' })).toBe(true);
    expect(isMetaAuthError({ message: 'invalid token' })).toBe(true);
    expect(isMetaAuthError({ message: 'authentication failed' })).toBe(true);
  });

  it('returns false for unrelated errors', async () => {
    const { isMetaAuthError } = await loadSubject();
    expect(isMetaAuthError(null)).toBe(false);
    expect(isMetaAuthError(undefined)).toBe(false);
    expect(isMetaAuthError({ code: 'SQLITE_BUSY', message: 'database is locked' })).toBe(false);
    expect(isMetaAuthError(new Error('network error'))).toBe(false);
  });
});
