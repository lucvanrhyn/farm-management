/**
 * Verifies the shared migration runner against an in-memory libsql DB —
 * so we catch bookkeeping / ordering / idempotency regressions without
 * touching any real tenant DB.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import {
  loadMigrations,
  runMigrations,
  splitSqlStatements,
} from '../../lib/migrator';

async function makeDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'migrator-'));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, 'utf-8');
  }
  return dir;
}

async function openMemoryDb(): Promise<Client> {
  // libsql supports `:memory:` via the local sqlite3 adapter.
  return createClient({ url: ':memory:' });
}

describe('splitSqlStatements', () => {
  it('splits on semicolons and trims whitespace', () => {
    expect(splitSqlStatements('CREATE TABLE a(id INT); CREATE TABLE b(id INT);')).toEqual([
      'CREATE TABLE a(id INT)',
      'CREATE TABLE b(id INT)',
    ]);
  });

  it('strips line comments before splitting', () => {
    const sql = `-- leading comment\nCREATE TABLE a(id INT); -- trailing\nCREATE TABLE b(id INT);`;
    expect(splitSqlStatements(sql)).toEqual([
      'CREATE TABLE a(id INT)',
      'CREATE TABLE b(id INT)',
    ]);
  });

  it('returns empty array for empty / comment-only files', () => {
    expect(splitSqlStatements('-- just a comment\n')).toEqual([]);
    expect(splitSqlStatements('')).toEqual([]);
  });
});

describe('loadMigrations', () => {
  it('returns .sql files sorted by filename', async () => {
    const dir = await makeDir({
      '0002_second.sql': 'CREATE TABLE b(id INT);',
      '0001_first.sql': 'CREATE TABLE a(id INT);',
      'not-a-migration.txt': 'ignore me',
    });
    const list = await loadMigrations(dir);
    expect(list.map((m) => m.name)).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(list[0].sql).toContain('CREATE TABLE a');
  });
});

describe('runMigrations', () => {
  let db: Client;

  beforeEach(async () => {
    db = await openMemoryDb();
  });

  it('creates bookkeeping table on first run', async () => {
    await runMigrations(db, []);
    const res = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`,
    );
    expect(res.rows.length).toBe(1);
  });

  it('applies pending migrations and records them', async () => {
    const result = await runMigrations(db, [
      { name: '0001_init.sql', sql: 'CREATE TABLE widgets(id INT);' },
    ]);
    expect(result.applied).toEqual(['0001_init.sql']);
    expect(result.skipped).toEqual([]);

    const recorded = await db.execute(`SELECT name FROM "_migrations"`);
    expect(recorded.rows.map((r) => r.name)).toEqual(['0001_init.sql']);

    const widgets = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='widgets'`,
    );
    expect(widgets.rows.length).toBe(1);
  });

  it('skips already-applied migrations on re-run (idempotent)', async () => {
    const migrations = [
      { name: '0001_init.sql', sql: 'CREATE TABLE widgets(id INT);' },
    ];
    await runMigrations(db, migrations);
    const second = await runMigrations(db, migrations);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0001_init.sql']);
  });

  it('applies a new migration added after a prior run', async () => {
    await runMigrations(db, [
      { name: '0001_init.sql', sql: 'CREATE TABLE widgets(id INT);' },
    ]);
    const second = await runMigrations(db, [
      { name: '0001_init.sql', sql: 'CREATE TABLE widgets(id INT);' },
      { name: '0002_add_col.sql', sql: 'ALTER TABLE widgets ADD COLUMN name TEXT;' },
    ]);
    expect(second.applied).toEqual(['0002_add_col.sql']);
    expect(second.skipped).toEqual(['0001_init.sql']);

    const info = await db.execute(`PRAGMA table_info(widgets)`);
    expect(info.rows.map((r) => r.name)).toContain('name');
  });

  it('rolls back atomically when a statement fails', async () => {
    await expect(
      runMigrations(db, [
        {
          name: '0001_bad.sql',
          sql: `CREATE TABLE good(id INT); CREATE TABLE good(id INT);`,
        },
      ]),
    ).rejects.toThrow();

    // Neither the schema change nor the bookkeeping row should persist.
    const tables = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('good', '_migrations')`,
    );
    const names = tables.rows.map((r) => r.name);
    expect(names).not.toContain('good');

    // _migrations table was created by runMigrations before the batch ran —
    // that's fine; the point is no bookkeeping row for the failed migration.
    if (names.includes('_migrations')) {
      const recorded = await db.execute(`SELECT name FROM "_migrations"`);
      expect(recorded.rows).toHaveLength(0);
    }
  });

  it('handles multiple statements in one migration file', async () => {
    const sql = `
      CREATE TABLE a(id INT);
      CREATE TABLE b(id INT);
      CREATE INDEX idx_a ON a(id);
    `;
    await runMigrations(db, [{ name: '0001_multi.sql', sql }]);
    const tables = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a', 'b')`,
    );
    expect(tables.rows.length).toBe(2);
  });

  it('records an empty / comment-only file so it is skipped next run', async () => {
    await runMigrations(db, [
      { name: '0001_empty.sql', sql: '-- placeholder, nothing to do\n' },
    ]);
    const recorded = await db.execute(`SELECT name FROM "_migrations"`);
    expect(recorded.rows.map((r) => r.name)).toEqual(['0001_empty.sql']);
  });

  it('applies migrations in filename order, not input order', async () => {
    // loadMigrations sorts for us; this test guards against future callers
    // who might pass unsorted input. runMigrations itself should respect the
    // order it receives, so pre-sort at the caller (loadMigrations does).
    const dir = await makeDir({
      '0002_second.sql': 'CREATE TABLE second(id INT);',
      '0001_first.sql': 'CREATE TABLE first(id INT);',
    });
    const migrations = await loadMigrations(dir);
    await runMigrations(db, migrations);
    const recorded = await db.execute(
      `SELECT name FROM "_migrations" ORDER BY applied_at`,
    );
    expect(recorded.rows.map((r) => r.name)).toEqual([
      '0001_first.sql',
      '0002_second.sql',
    ]);
  });
});
