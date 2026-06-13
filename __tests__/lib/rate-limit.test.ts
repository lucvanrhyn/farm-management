import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';

import { checkRateLimit } from '@/lib/rate-limit';
import {
  __setMetaClientForTest,
  __resetMetaClient,
  getMetaClient,
} from '@/lib/meta-db';
import { logger } from '@/lib/logger';

/**
 * S28 (api-M2 / OB-003 / auth-M3 / auth-F1) — shared-store rate limiter.
 *
 * The old in-memory `Map` limiter was per-instance: on Vercel each serverless
 * instance kept its own window, and cold starts wiped it, so the cap was
 * trivially bypassable by spreading requests across instances. This suite
 * proves the replacement is a SHARED fixed-window counter backed by the META
 * DB — two calls with the same key see the same counter (not per-instance) —
 * and that a META-DB failure FAILS OPEN (best-effort cost/abuse protection
 * must never lock users out, preserving the old cold-start availability).
 *
 * Mirrors the in-memory-libSQL idiom from find-user-by-identifier.test.ts.
 */

const RATE_LIMIT_DDL = `
  CREATE TABLE IF NOT EXISTS "RateLimit" (
    "key"           TEXT PRIMARY KEY,
    "windowStartMs" INTEGER NOT NULL,
    "count"         INTEGER NOT NULL
  );
`;

async function freshMetaDb(): Promise<Client> {
  __resetMetaClient();
  const client = createClient({ url: ':memory:' });
  await client.executeMultiple(RATE_LIMIT_DDL);
  __setMetaClientForTest(client);
  return client;
}

describe('checkRateLimit (shared META-DB fixed-window counter)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await freshMetaDb();
  });

  afterEach(() => {
    __resetMetaClient();
    vi.useRealTimers();
  });

  it('allows requests under the limit', async () => {
    const r1 = await checkRateLimit('k', 3, 60_000);
    const r2 = await checkRateLimit('k', 3, 60_000);
    const r3 = await checkRateLimit('k', 3, 60_000);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r1.retryAfterMs).toBe(0);
  });

  it('blocks once the count exceeds maxRequests, with a positive retryAfterMs', async () => {
    vi.useFakeTimers();
    const now = 1_000_000;
    vi.setSystemTime(now);
    const windowMs = 60_000;

    // First two consume the window (max=2), third is blocked.
    await checkRateLimit('k', 2, windowMs);
    await checkRateLimit('k', 2, windowMs);
    const blocked = await checkRateLimit('k', 2, windowMs);

    expect(blocked.allowed).toBe(false);
    // Window opened at `now`; retryAfterMs = windowStart + windowMs - now.
    expect(blocked.retryAfterMs).toBe(windowMs);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets the counter once the window expires', async () => {
    vi.useFakeTimers();
    const windowMs = 60_000;
    vi.setSystemTime(1_000_000);

    await checkRateLimit('k', 1, windowMs);
    const blockedSameWindow = await checkRateLimit('k', 1, windowMs);
    expect(blockedSameWindow.allowed).toBe(false);

    // Advance past the window — the counter must reset to a fresh window.
    vi.setSystemTime(1_000_000 + windowMs + 1);
    const afterExpiry = await checkRateLimit('k', 1, windowMs);
    expect(afterExpiry.allowed).toBe(true);
    expect(afterExpiry.retryAfterMs).toBe(0);
  });

  it('shares state across calls (not per-instance) — proves the SHARED store fix', async () => {
    // Two distinct call sequences with the SAME key both hit the one injected
    // META client. If state were per-instance (the old Map bug), each would
    // start from zero and never block. Because the counter is shared, the
    // combined call count crosses the cap.
    const windowMs = 60_000;
    const max = 3;

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await checkRateLimit('shared-key', max, windowMs));
    }

    const allowedCount = results.filter((r) => r.allowed).length;
    // Exactly `max` allowed, the rest blocked — the shared counter monotonically
    // increments across calls rather than resetting per call/instance.
    expect(allowedCount).toBe(max);
    expect(results[3].allowed).toBe(false);
    expect(results[4].allowed).toBe(false);

    // And the shared row in the DB reflects the total attempts.
    const row = await getMetaClient().execute({
      sql: 'SELECT "count" FROM "RateLimit" WHERE "key" = ?',
      args: ['shared-key'],
    });
    expect(Number(row.rows[0].count)).toBe(5);
  });

  it('keys are isolated — one key does not consume another key budget', async () => {
    const windowMs = 60_000;
    await checkRateLimit('key-a', 1, windowMs);
    const aBlocked = await checkRateLimit('key-a', 1, windowMs);
    const bAllowed = await checkRateLimit('key-b', 1, windowMs);

    expect(aBlocked.allowed).toBe(false);
    expect(bAllowed.allowed).toBe(true);
  });

  it('FAILS OPEN and logs a structured warning when the META DB throws', async () => {
    // Inject a client whose execute rejects — simulates a meta-DB blip / token
    // expiry / network error. The limiter must NOT lock the user out.
    __resetMetaClient();
    const throwingClient = {
      execute: vi.fn().mockRejectedValue(new Error('meta-db unreachable')),
      close: vi.fn(),
    } as unknown as Client;
    __setMetaClientForTest(throwingClient);

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await checkRateLimit('k', 1, 60_000);

    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Structured warning — not a silent catch. First arg is a tagged message.
    expect(warnSpy.mock.calls[0][0]).toContain('[rate-limit]');
  });
});
