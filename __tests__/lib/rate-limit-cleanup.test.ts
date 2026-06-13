import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';

import { cleanupExpiredRateLimits } from '@/lib/rate-limit';
import { __setMetaClientForTest, __resetMetaClient } from '@/lib/meta-db';
import { logger } from '@/lib/logger';

/**
 * RateLimit TTL janitor (follow-up to S28, background chip 2026-06-13).
 *
 * The shared fixed-window limiter keeps one row per distinct key (IP /
 * identifier). The window resets in place but the row never departs, so the
 * META table grows with the set of unique keys ever seen. A closed-window row
 * holds no live state — a later request re-inserts a fresh count=1 row — so
 * pruning rows whose window closed long ago is correctness-neutral and bounds
 * table growth. The default TTL (24h) sits well beyond the longest window any
 * caller uses (1h, the register limiter).
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

const HOUR = 60 * 60 * 1000;

describe('cleanupExpiredRateLimits', () => {
  let db: Client;

  beforeEach(async () => {
    vi.restoreAllMocks();
    db = await freshMetaDb();
  });
  afterEach(() => __resetMetaClient());

  async function seed(key: string, windowStartMs: number) {
    await db.execute({
      sql: `INSERT INTO "RateLimit" ("key", "windowStartMs", "count") VALUES (?, ?, 1)`,
      args: [key, windowStartMs],
    });
  }
  async function remainingKeys(): Promise<string[]> {
    const r = await db.execute(`SELECT "key" FROM "RateLimit" ORDER BY "key"`);
    return r.rows.map((row) => String(row.key));
  }

  it('deletes rows older than the given TTL and keeps fresh ones', async () => {
    const now = Date.now();
    await seed('stale', now - 25 * HOUR);
    await seed('fresh', now - 5 * 60 * 1000);

    const deleted = await cleanupExpiredRateLimits(24 * HOUR);

    expect(deleted).toBe(1);
    expect(await remainingKeys()).toEqual(['fresh']);
  });

  it('defaults to a 24h TTL when none is supplied', async () => {
    const now = Date.now();
    await seed('old', now - 48 * HOUR);
    await seed('recent', now - 1 * HOUR);

    const deleted = await cleanupExpiredRateLimits();

    expect(deleted).toBe(1);
    expect(await remainingKeys()).toEqual(['recent']);
  });

  it('fails soft (returns 0, warns) when the META DB is unavailable', async () => {
    __setMetaClientForTest({
      execute: () => Promise.reject(new Error('meta down')),
    } as unknown as Client);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const deleted = await cleanupExpiredRateLimits();

    expect(deleted).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});
