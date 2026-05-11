/**
 * Issue #206 — migration smoke test for 0019_observation_idempotency.sql.
 *
 * Asserts that the migration:
 *   - Adds a `clientLocalId` TEXT column to `Observation`.
 *   - Creates a UNIQUE INDEX named `idx_observation_client_local_id` on that
 *     column, guarded by `IF NOT EXISTS` for partial-apply safety.
 *   - Round-trips through the canonical `runMigrations` runner cleanly,
 *     including `verifyMigrationApplied` (which catches the silent-failure
 *     class from PRD #128 § wave 132).
 *   - Enforces uniqueness on a non-null `clientLocalId` (two inserts with
 *     the same UUID raise a UNIQUE constraint), while allowing multiple
 *     NULL values (back-compat with legacy rows).
 *
 * This is the equivalent of the migration smoke check the parent prompt asks
 * for in the PR body — run against an in-memory libsql Client.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';

import { runMigrations, splitSqlStatements } from '@/lib/migrator';

const REPO_ROOT = join(__dirname, '..', '..');

async function readMigration(): Promise<string> {
  return readFile(
    join(REPO_ROOT, 'migrations', '0019_observation_idempotency.sql'),
    'utf-8',
  );
}

describe('migration 0019_observation_idempotency — SQL shape', () => {
  it('adds clientLocalId TEXT column to Observation', async () => {
    const sql = await readMigration();
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+"?Observation"?\s+ADD\s+COLUMN\s+"?clientLocalId"?\s+TEXT/i,
    );
  });

  it('creates UNIQUE INDEX guarded by IF NOT EXISTS', async () => {
    const sql = await readMigration();
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"?idx_observation_client_local_id"?/i,
    );
    expect(sql).toMatch(
      /ON\s+"?Observation"?\s*\(\s*"?clientLocalId"?\s*\)/i,
    );
  });
});

describe('migration 0019_observation_idempotency — applies against in-memory libsql', () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    // Minimal Observation shape matching the post-0003 schema.
    await db.execute(`
      CREATE TABLE "Observation" (
        "id"         TEXT PRIMARY KEY,
        "type"       TEXT NOT NULL,
        "campId"     TEXT NOT NULL,
        "animalId"   TEXT,
        "details"    TEXT NOT NULL,
        "observedAt" TEXT NOT NULL,
        "species"    TEXT
      )
    `);
  });

  it('applies cleanly via the canonical migrator (verifyMigrationApplied passes)', async () => {
    const sql = await readMigration();
    const result = await runMigrations(db, [
      { name: '0019_observation_idempotency.sql', sql },
    ]);
    expect(result.applied).toContain('0019_observation_idempotency.sql');

    // The column landed.
    const cols = await db.execute(`SELECT name FROM pragma_table_info('Observation')`);
    const colNames = new Set(cols.rows.map((r) => r.name as string));
    expect(colNames.has('clientLocalId')).toBe(true);

    // The unique index landed.
    const idx = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_observation_client_local_id'`,
    );
    expect(idx.rows.length).toBe(1);
  });

  it('rejects duplicate non-null clientLocalId values (UNIQUE constraint)', async () => {
    const sql = await readMigration();
    for (const stmt of splitSqlStatements(sql)) {
      await db.execute(stmt);
    }

    await db.execute({
      sql: `INSERT INTO "Observation" (id, type, campId, animalId, details, observedAt, clientLocalId)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['o1', 'camp_condition', 'A', null, '{}', '2026-05-11T10:00:00Z', 'uuid-1'],
    });

    await expect(
      db.execute({
        sql: `INSERT INTO "Observation" (id, type, campId, animalId, details, observedAt, clientLocalId)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: ['o2', 'camp_condition', 'A', null, '{}', '2026-05-11T10:00:00Z', 'uuid-1'],
      }),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it('allows multiple NULL clientLocalId rows (back-compat with legacy data)', async () => {
    const sql = await readMigration();
    for (const stmt of splitSqlStatements(sql)) {
      await db.execute(stmt);
    }

    await db.execute({
      sql: `INSERT INTO "Observation" (id, type, campId, animalId, details, observedAt, clientLocalId)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['o1', 'camp_condition', 'A', null, '{}', '2026-05-11T10:00:00Z', null],
    });
    await db.execute({
      sql: `INSERT INTO "Observation" (id, type, campId, animalId, details, observedAt, clientLocalId)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['o2', 'camp_condition', 'A', null, '{}', '2026-05-11T10:00:00Z', null],
    });

    const rows = await db.execute(`SELECT COUNT(*) AS c FROM "Observation"`);
    expect(Number(rows.rows[0]?.c)).toBe(2);
  });
});
