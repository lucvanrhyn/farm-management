/**
 * lib/ops/__tests__/seed-test-admin.test.ts
 *
 * Unit tests for the test-admin meta-DB seed module (issue #527, code half of
 * the #108 gate). Exercised against an in-memory libSQL client — the same
 * `Client` shape the real meta DB returns, so `rowsAffected` / `INSERT OR
 * IGNORE` idempotency behave exactly as in production. We also wrap `execute`
 * with a spy on the negative-path assertions so we can prove the module
 * refuses BEFORE issuing any write.
 *
 * Behaviour under test (external contract only):
 *   1. Seeds a verified (email_verified=1), bcrypt-cost-12 user + an ADMIN
 *      farm_users row against an existing tenant.
 *   2. A second invocation is a no-op (createdUser/createdMembership both
 *      false; no duplicate rows).
 *   3. Unknown farm slug → TestAdminSeedError (this script maps onto an
 *      existing tenant; it never creates farms).
 *   4. A prod-reserved slug without `force` → TestAdminSeedError, and no write
 *      is attempted.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { compareSync } from 'bcryptjs';
import { seedTestAdmin, TestAdminSeedError, PROD_FARM_SLUGS } from '@/lib/ops/seed-test-admin';

/** Mirror the three canonical meta-DB tables from scripts/seed-meta-db.ts. */
async function seedMetaSchema(db: Client): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE users (
      id                    TEXT PRIMARY KEY,
      email                 TEXT UNIQUE,
      username              TEXT UNIQUE NOT NULL,
      password_hash         TEXT NOT NULL,
      name                  TEXT,
      email_verified        INTEGER NOT NULL DEFAULT 0,
      verification_token    TEXT,
      verification_expires  TEXT,
      created_at            TEXT NOT NULL
    );
    CREATE TABLE farms (
      id               TEXT PRIMARY KEY,
      slug             TEXT UNIQUE NOT NULL,
      display_name     TEXT NOT NULL,
      turso_url        TEXT NOT NULL,
      turso_auth_token TEXT NOT NULL,
      logo_url         TEXT,
      tier             TEXT NOT NULL DEFAULT 'advanced',
      created_at       TEXT NOT NULL
    );
    CREATE TABLE farm_users (
      user_id  TEXT NOT NULL REFERENCES users(id),
      farm_id  TEXT NOT NULL REFERENCES farms(id),
      role     TEXT NOT NULL,
      PRIMARY KEY (user_id, farm_id)
    );
  `);
}

async function insertFarm(db: Client, slug: string, id = `farm-${slug}`): Promise<string> {
  await db.execute({
    sql: `INSERT INTO farms (id, slug, display_name, turso_url, turso_auth_token, tier, created_at)
          VALUES (?, ?, ?, ?, ?, 'advanced', ?)`,
    args: [id, slug, slug, 'libsql://x', 'tok', new Date().toISOString()],
  });
  return id;
}

const INPUT = {
  email: 'qa-admin@example.test',
  password: 'correct-horse-battery',
  farmSlug: 'trio-b',
} as const;

describe('seedTestAdmin', () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    await seedMetaSchema(db);
  });

  it('inserts a verified bcrypt-cost-12 user and an ADMIN farm_users row', async () => {
    const farmId = await insertFarm(db, INPUT.farmSlug);

    const result = await seedTestAdmin(db, { ...INPUT });

    expect(result.createdUser).toBe(true);
    expect(result.createdMembership).toBe(true);
    expect(result.farmId).toBe(farmId);
    expect(result.userId).toBeTruthy();

    // User row: verified + bcrypt-cost-12 hash of the plaintext password.
    const userRows = (
      await db.execute({
        sql: 'SELECT id, email, username, password_hash, email_verified FROM users WHERE email = ?',
        args: [INPUT.email],
      })
    ).rows;
    expect(userRows).toHaveLength(1);
    const user = userRows[0];
    expect(user.id).toBe(result.userId);
    expect(Number(user.email_verified)).toBe(1);
    expect(user.username).toBeTruthy();
    // bcrypt cost-12 hashes are prefixed `$2a$12$` / `$2b$12$`.
    expect(String(user.password_hash)).toMatch(/^\$2[aby]\$12\$/);
    expect(compareSync(INPUT.password, String(user.password_hash))).toBe(true);

    // Membership row: ADMIN, linked to the resolved user + farm.
    const fuRows = (
      await db.execute({
        sql: 'SELECT user_id, farm_id, role FROM farm_users WHERE user_id = ? AND farm_id = ?',
        args: [result.userId, farmId],
      })
    ).rows;
    expect(fuRows).toHaveLength(1);
    expect(fuRows[0].role).toBe('ADMIN');
  });

  it('is idempotent — a second invocation is a no-op (no duplicate rows)', async () => {
    await insertFarm(db, INPUT.farmSlug);

    const first = await seedTestAdmin(db, { ...INPUT });
    const second = await seedTestAdmin(db, { ...INPUT });

    expect(first.createdUser).toBe(true);
    expect(first.createdMembership).toBe(true);
    expect(second.createdUser).toBe(false);
    expect(second.createdMembership).toBe(false);
    // Stable IDs across runs.
    expect(second.userId).toBe(first.userId);
    expect(second.farmId).toBe(first.farmId);

    const userCount = Number(
      (await db.execute({ sql: 'SELECT COUNT(*) AS n FROM users WHERE email = ?', args: [INPUT.email] }))
        .rows[0].n,
    );
    const fuCount = Number(
      (await db.execute('SELECT COUNT(*) AS n FROM farm_users')).rows[0].n,
    );
    expect(userCount).toBe(1);
    expect(fuCount).toBe(1);
  });

  it('throws TestAdminSeedError when the farm slug does not exist', async () => {
    // No farm inserted.
    await expect(seedTestAdmin(db, { ...INPUT, farmSlug: 'no-such-tenant' })).rejects.toBeInstanceOf(
      TestAdminSeedError,
    );

    // Nothing was written.
    const userCount = Number((await db.execute('SELECT COUNT(*) AS n FROM users')).rows[0].n);
    expect(userCount).toBe(0);
  });

  it('refuses a prod-reserved slug without force, before issuing any write', async () => {
    const prodSlug = PROD_FARM_SLUGS[0];
    expect(prodSlug).toBe('basson-boerdery');
    await insertFarm(db, prodSlug);

    const spy = vi.spyOn(db, 'execute');

    await expect(seedTestAdmin(db, { ...INPUT, farmSlug: prodSlug })).rejects.toBeInstanceOf(
      TestAdminSeedError,
    );
    // Guard fires before any DB call — no SELECT/INSERT issued.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('allows a prod-reserved slug when force is true', async () => {
    const prodSlug = PROD_FARM_SLUGS[0];
    await insertFarm(db, prodSlug);

    const result = await seedTestAdmin(db, { ...INPUT, farmSlug: prodSlug, force: true });
    expect(result.createdUser).toBe(true);
    expect(result.createdMembership).toBe(true);
  });

  it('derives a stable sanitized username from the email local-part', async () => {
    await insertFarm(db, INPUT.farmSlug);
    await seedTestAdmin(db, { ...INPUT, email: 'QA.Admin+ci@example.test' });

    const username = String(
      (await db.execute({
        sql: 'SELECT username FROM users WHERE email = ?',
        args: ['QA.Admin+ci@example.test'],
      })).rows[0].username,
    );
    // Sanitized to the register-route allowed charset [a-zA-Z0-9_-].
    expect(username).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(username.length).toBeGreaterThanOrEqual(3);
  });
});
