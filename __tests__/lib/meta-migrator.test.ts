/**
 * Tests for lib/meta-migrator.ts
 *
 * Covers:
 * (a) Idempotent apply — running twice doesn't double-apply.
 * (b) Tracking table created on first run.
 * (c) Collision detection for duplicate prefixes.
 * (d) Atomic batch — failure rolls back tracking insert.
 *
 * Uses in-memory libSQL client for full SQL fidelity without network calls.
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import {
  runMetaMigrations,
  assertNoMetaPrefixCollisions,
} from '@/lib/meta-migrator';
import type { MigrationFile } from '@/lib/migrator';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function freshDb(): Promise<Client> {
  return createClient({ url: 'file::memory:' });
}

function makeMigration(name: string, sql: string): MigrationFile {
  return { name, sql };
}

// ── (b) Tracking table creation ───────────────────────────────────────────────

describe('runMetaMigrations — tracking table bootstrap', () => {
  it('creates _meta_migrations table on a fresh DB', async () => {
    const db = await freshDb();
    await runMetaMigrations(db, []);

    const res = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='_meta_migrations'`,
      args: [],
    });
    expect(res.rows).toHaveLength(1);
  });

  it('table has name (TEXT PK) and applied_at (TEXT NOT NULL) columns', async () => {
    const db = await freshDb();
    await runMetaMigrations(db, []);

    // Insert + select back verifies column contract without schema-introspection
    await db.execute({
      sql: `INSERT INTO "_meta_migrations" (name, applied_at) VALUES ('test.sql', '2026-01-01T00:00:00.000Z')`,
      args: [],
    });
    const res = await db.execute(`SELECT name, applied_at FROM "_meta_migrations"`);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].name).toBe('test.sql');
    expect(res.rows[0].applied_at).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ── (a) Idempotency ───────────────────────────────────────────────────────────

describe('runMetaMigrations — idempotency', () => {
  it('applies a migration once and skips it on the second call', async () => {
    const db = await freshDb();
    const migration = makeMigration(
      '0001_test.sql',
      `CREATE TABLE IF NOT EXISTS test_tbl (id TEXT PRIMARY KEY)`,
    );

    const first = await runMetaMigrations(db, [migration]);
    expect(first.applied).toEqual(['0001_test.sql']);
    expect(first.skipped).toEqual([]);

    const second = await runMetaMigrations(db, [migration]);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0001_test.sql']);
  });

  it('applies only the new migration when one of two has already been applied', async () => {
    const db = await freshDb();
    const m1 = makeMigration('0001_first.sql', `CREATE TABLE IF NOT EXISTS tbl1 (id TEXT PRIMARY KEY)`);
    const m2 = makeMigration('0002_second.sql', `CREATE TABLE IF NOT EXISTS tbl2 (id TEXT PRIMARY KEY)`);

    await runMetaMigrations(db, [m1]);

    const result = await runMetaMigrations(db, [m1, m2]);
    expect(result.applied).toEqual(['0002_second.sql']);
    expect(result.skipped).toEqual(['0001_first.sql']);
  });

  it('running with empty migrations on a fresh DB is a no-op', async () => {
    const db = await freshDb();
    const result = await runMetaMigrations(db, []);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

// ── (d) Atomic batch — failure rolls back tracking insert ─────────────────────

describe('runMetaMigrations — atomicity', () => {
  it('does not record a migration in _meta_migrations when the SQL fails', async () => {
    const db = await freshDb();
    // SQL that will fail: cannot create a table with a duplicate column name
    const badMigration = makeMigration(
      '0001_bad.sql',
      `CREATE TABLE broken_tbl (id TEXT PRIMARY KEY, id TEXT)`,
    );

    await expect(runMetaMigrations(db, [badMigration])).rejects.toThrow();

    // Tracking row must NOT have been inserted (rollback confirmed)
    const res = await db.execute(`SELECT name FROM "_meta_migrations"`);
    expect(res.rows).toHaveLength(0);
  });

  it('preserves previously applied migrations when a later one fails', async () => {
    const db = await freshDb();
    const good = makeMigration('0001_good.sql', `CREATE TABLE IF NOT EXISTS ok_tbl (id TEXT PRIMARY KEY)`);
    const bad = makeMigration('0002_bad.sql', `CREATE TABLE broken (id TEXT, id TEXT)`);

    await runMetaMigrations(db, [good]);
    await expect(runMetaMigrations(db, [good, bad])).rejects.toThrow();

    // 0001 should still be recorded, 0002 should not
    const res = await db.execute(`SELECT name FROM "_meta_migrations" ORDER BY name`);
    expect(res.rows.map((r) => r.name)).toEqual(['0001_good.sql']);
  });
});

// ── (c) Collision detection ───────────────────────────────────────────────────

describe('assertNoMetaPrefixCollisions', () => {
  it('passes when all prefixes are unique', () => {
    expect(() =>
      assertNoMetaPrefixCollisions([
        '0001_branch_clones_soak_sha.sql',
        '0002_something_else.sql',
        '0003_another.sql',
      ]),
    ).not.toThrow();
  });

  it('throws when two files share the same numeric prefix', () => {
    expect(() =>
      assertNoMetaPrefixCollisions([
        '0001_branch_clones_soak_sha.sql',
        '0001_duplicate_prefix.sql',
      ]),
    ).toThrow(/duplicate meta-migration prefix/);
  });

  it('throws with the collision detail in the error message', () => {
    let msg = '';
    try {
      assertNoMetaPrefixCollisions([
        '0002_a.sql',
        '0002_b.sql',
      ]);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('0002');
    expect(msg).toContain('0002_a.sql');
    expect(msg).toContain('0002_b.sql');
  });

  it('ignores files without a numeric prefix', () => {
    expect(() =>
      assertNoMetaPrefixCollisions([
        'README.md',
        '0001_real.sql',
        'no-prefix.sql',
      ]),
    ).not.toThrow();
  });

  it('passes on an empty array', () => {
    expect(() => assertNoMetaPrefixCollisions([])).not.toThrow();
  });
});

// ── Multi-statement SQL ───────────────────────────────────────────────────────

describe('runMetaMigrations — multi-statement migrations', () => {
  it('applies all statements in a file separated by semicolons', async () => {
    const db = await freshDb();
    const migration = makeMigration(
      '0001_multi.sql',
      [
        `CREATE TABLE IF NOT EXISTS multi_a (id TEXT PRIMARY KEY)`,
        `CREATE TABLE IF NOT EXISTS multi_b (id TEXT PRIMARY KEY)`,
        `CREATE INDEX IF NOT EXISTS idx_multi_a ON multi_a(id)`,
      ].join(';\n'),
    );

    const result = await runMetaMigrations(db, [migration]);
    expect(result.applied).toEqual(['0001_multi.sql']);

    // Both tables must exist
    const res = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('multi_a','multi_b') ORDER BY name`,
    );
    expect(res.rows.map((r) => r.name)).toEqual(['multi_a', 'multi_b']);
  });
});

// ── Return value shape ────────────────────────────────────────────────────────

describe('runMetaMigrations — return value', () => {
  it('returns applied and skipped arrays with correct file names', async () => {
    const db = await freshDb();
    const m1 = makeMigration('0001_first.sql', `CREATE TABLE IF NOT EXISTS ret1 (id TEXT PRIMARY KEY)`);
    const m2 = makeMigration('0002_second.sql', `CREATE TABLE IF NOT EXISTS ret2 (id TEXT PRIMARY KEY)`);

    // Apply m1 first so it becomes "skipped" on the second run
    await runMetaMigrations(db, [m1]);

    const result = await runMetaMigrations(db, [m1, m2]);
    expect(result).toMatchObject({
      applied: ['0002_second.sql'],
      skipped: ['0001_first.sql'],
    });
  });
});
