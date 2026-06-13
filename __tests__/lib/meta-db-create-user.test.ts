import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';

import {
  createUser,
  getUserByUsername,
  getUserByEmail,
  createFarm,
  createFarmUser,
  deleteFarmUser,
  deleteFarm,
  deleteUser,
  __setMetaClientForTest,
  __resetMetaClient,
} from '@/lib/meta-db';

/**
 * S29 (findings H7 + H6/OB-007) — make self-service provisioning atomic.
 *
 * H7: `createUser` must NOT use `INSERT OR IGNORE`. A duplicate username (or
 * email) row must THROW a UNIQUE-constraint error so provisioning aborts and
 * the compensating-delete catch fires — rather than silently no-op'ing and
 * leaving an orphaned farm pointing at a user row that was never inserted.
 *
 * H6: the cleanup path needs reverse-order compensating deletes
 * (deleteFarmUser / deleteFarm / deleteUser) — exercised here at the helper
 * level; the orchestration is asserted in provisioning.test.ts.
 *
 * These tests run against a REAL in-memory libSQL client (same driver, no
 * network) with the prod `users_username_unique` index, so the throw behaviour
 * is verified end-to-end, not mocked. Mirrors find-user-by-identifier.test.ts.
 */

async function freshMetaDb(): Promise<void> {
  __resetMetaClient();
  const client = createClient({ url: ':memory:' });
  await client.executeMultiple(`
    CREATE TABLE users (
      id                    TEXT PRIMARY KEY,
      email                 TEXT,
      username              TEXT NOT NULL,
      password_hash         TEXT NOT NULL,
      name                  TEXT,
      email_verified        INTEGER NOT NULL DEFAULT 0,
      verification_token    TEXT,
      verification_expires  TEXT,
      created_at            TEXT NOT NULL
    );
    CREATE UNIQUE INDEX users_username_unique ON users(username);
    CREATE TABLE farms (
      id                TEXT PRIMARY KEY,
      slug              TEXT NOT NULL UNIQUE,
      display_name      TEXT NOT NULL,
      turso_url         TEXT NOT NULL,
      turso_auth_token  TEXT NOT NULL,
      tier              TEXT NOT NULL,
      created_at        TEXT NOT NULL
    );
    CREATE TABLE farm_users (
      user_id  TEXT NOT NULL,
      farm_id  TEXT NOT NULL,
      role     TEXT NOT NULL,
      PRIMARY KEY (user_id, farm_id)
    );
  `);
  __setMetaClientForTest(client);
}

async function countUsers(): Promise<number> {
  const { getMetaClient } = await import('@/lib/meta-db');
  const r = await getMetaClient().execute('SELECT COUNT(*) AS c FROM users');
  return Number(r.rows[0].c);
}

describe('createUser — H7 duplicate must throw (no silent OR IGNORE)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await freshMetaDb();
  });

  it('inserts a new user normally', async () => {
    await createUser('u1', 'a@example.com', 'alice', 'hash', 'Alice');
    const u = await getUserByEmail('a@example.com');
    expect(u?.id).toBe('u1');
    expect(u?.username).toBe('alice');
  });

  it('THROWS on a duplicate username (different email) — not a silent no-op', async () => {
    await createUser('u1', 'a@example.com', 'alice', 'hash', 'Alice');
    await expect(
      createUser('u2', 'b@example.com', 'alice', 'hash', 'Bob'),
    ).rejects.toThrow();
    // The second user was NOT inserted — exactly one row remains.
    expect(await countUsers()).toBe(1);
    // And the row that exists is the original (u1), not silently overwritten.
    const u = await getUserByUsername('alice');
    expect(u?.id).toBe('u1');
  });

  it('THROWS on a duplicate primary-key id', async () => {
    await createUser('u1', 'a@example.com', 'alice', 'hash', 'Alice');
    await expect(
      createUser('u1', 'c@example.com', 'carol', 'hash', 'Carol'),
    ).rejects.toThrow();
    expect(await countUsers()).toBe(1);
  });
});

describe('getUserByUsername', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await freshMetaDb();
  });

  it('returns the user for an existing username', async () => {
    await createUser('u1', 'a@example.com', 'alice', 'hash', 'Alice');
    const u = await getUserByUsername('alice');
    expect(u).not.toBeNull();
    expect(u?.id).toBe('u1');
    expect(u?.email).toBe('a@example.com');
  });

  it('returns null for an unknown username', async () => {
    expect(await getUserByUsername('nobody')).toBeNull();
  });
});

describe('compensating-delete helpers (H6)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await freshMetaDb();
  });

  it('deleteFarmUser / deleteFarm / deleteUser remove their rows', async () => {
    await createUser('u1', 'a@example.com', 'alice', 'hash', 'Alice');
    await createFarm('f1', 'alice-farm', 'Alice Farm', 'libsql://x', 'tok', 'basic');
    await createFarmUser('u1', 'f1', 'ADMIN');

    const { getMetaClient } = await import('@/lib/meta-db');
    const client = getMetaClient();

    await deleteFarmUser('u1', 'f1');
    expect(
      (await client.execute('SELECT COUNT(*) AS c FROM farm_users')).rows[0].c,
    ).toBe(0);

    await deleteFarm('f1');
    expect(
      (await client.execute('SELECT COUNT(*) AS c FROM farms')).rows[0].c,
    ).toBe(0);

    await deleteUser('u1');
    expect(await countUsers()).toBe(0);
  });

  it('delete helpers are idempotent — no throw when the row is absent', async () => {
    await expect(deleteFarmUser('nope', 'nope')).resolves.toBeUndefined();
    await expect(deleteFarm('nope')).resolves.toBeUndefined();
    await expect(deleteUser('nope')).resolves.toBeUndefined();
  });
});
