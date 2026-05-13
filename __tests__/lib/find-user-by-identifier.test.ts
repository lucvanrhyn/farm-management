import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';

import {
  findUserByIdentifier,
  AUTH_LOOKUP_ERROR,
  __setMetaClientForTest,
  __resetMetaClient,
} from '@/lib/meta-db';

/**
 * Wave 6b — `findUserByIdentifier` (issue #261).
 *
 * Sign-in identifier is **username only** (the maintainer-locked HITL
 * decision in tasks/auth-and-users.md). This module replaces the legacy
 * `getUserByIdentifier` (which OR'd email/username) with a typed-result
 * function so the auth surface fails closed on ambiguity / not-found
 * instead of returning `null` and bubbling a generic "wrong password"
 * blame back to the user.
 */

async function freshMetaDb(): Promise<void> {
  __resetMetaClient();
  // In-memory libSQL — same driver, no network. Mirrors the prod meta-DB
  // schema for the columns this function touches (see scripts/seed-meta-db.ts).
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
  `);
  __setMetaClientForTest(client);
}

async function insertUser(
  id: string,
  username: string,
  email: string | null,
): Promise<void> {
  const { getMetaClient } = await import('@/lib/meta-db');
  await getMetaClient().execute({
    sql: `INSERT INTO users (id, username, email, password_hash, name, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, username, email, 'hash', 'Name', new Date().toISOString()],
  });
}

describe('findUserByIdentifier', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await freshMetaDb();
  });

  it('resolves a user by username (case-sensitive match)', async () => {
    await insertUser('user-1', 'dicky', 'dicky@example.com');

    const result = await findUserByIdentifier('dicky');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe('user-1');
      expect(result.user.username).toBe('dicky');
    }
  });

  it('returns NOT_FOUND when the username does not exist', async () => {
    await insertUser('user-1', 'dicky', 'dicky@example.com');

    const result = await findUserByIdentifier('nobody');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(AUTH_LOOKUP_ERROR.NOT_FOUND);
    }
  });

  it('does NOT resolve a user when the identifier looks like an email', async () => {
    // Username-only contract: an email-shaped identifier should not match
    // the user's email column. (Pre-#261 behaviour OR'd email/username,
    // which the maintainer explicitly retired.)
    await insertUser('user-1', 'dicky', 'dicky@example.com');

    const result = await findUserByIdentifier('dicky@example.com');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(AUTH_LOOKUP_ERROR.NOT_FOUND);
    }
  });

  it('returns AMBIGUOUS only when storage returns >1 row (defence-in-depth)', async () => {
    // The DB unique constraint on username makes this physically impossible
    // for production data, but the function must still surface a typed
    // error (not silently pick the first row) if it ever does happen —
    // e.g. legacy meta-DB that pre-dates migration 0003 + duplicate slips
    // through. This is the "ambiguous" branch the maintainer asked for.
    const { getMetaClient } = await import('@/lib/meta-db');
    // Drop the unique index so we can insert two rows with the same
    // username for this defence-in-depth scenario.
    await getMetaClient().execute(`DROP INDEX users_username_unique`);
    await insertUser('user-a', 'twin', 'a@example.com');
    await insertUser('user-b', 'twin', 'b@example.com');

    const result = await findUserByIdentifier('twin');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(AUTH_LOOKUP_ERROR.AMBIGUOUS);
    }
  });

  it('treats empty / whitespace-only identifier as NOT_FOUND without hitting the DB', async () => {
    const { getMetaClient } = await import('@/lib/meta-db');
    const spy = vi.spyOn(getMetaClient(), 'execute');

    const blank = await findUserByIdentifier('   ');
    const empty = await findUserByIdentifier('');

    expect(blank.ok).toBe(false);
    expect(empty.ok).toBe(false);
    if (!blank.ok) expect(blank.code).toBe(AUTH_LOOKUP_ERROR.NOT_FOUND);
    if (!empty.ok) expect(empty.code).toBe(AUTH_LOOKUP_ERROR.NOT_FOUND);
    expect(spy).not.toHaveBeenCalled();
  });
});
