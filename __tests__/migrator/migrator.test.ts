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

  it('throws when two .sql files share the same NNNN_ numeric prefix', async () => {
    // Wave/56 SEV-1 root cause: two files with `0005_*` prefix shipped
    // together. `localeCompare` picks ONE deterministic ordering of the pair,
    // but post-merge-promote was stamped against a different ordering on a
    // peer tenant — so at least one column from each colliding pair never
    // landed on prod. The runner must hard-fail instead of silently picking
    // one. The error message must name BOTH offenders so the operator can
    // renumber.
    const dir = await makeDir({
      '0005_camp_mob_species.sql': 'ALTER TABLE Camp ADD COLUMN species TEXT;',
      '0005_sars_livestock_election.sql': 'CREATE TABLE SarsLivestockElection (id TEXT);',
      '0006_aia_tag_fields.sql': 'ALTER TABLE Animal ADD COLUMN tagNumber TEXT;',
    });
    await expect(loadMigrations(dir)).rejects.toThrow(
      /duplicate migration prefix.*0005.*camp_mob_species.*sars_livestock_election|duplicate migration prefix.*0005.*sars_livestock_election.*camp_mob_species/i,
    );
  });

  it('throws when more than two .sql files share the same NNNN_ numeric prefix', async () => {
    const dir = await makeDir({
      '0009_a.sql': 'SELECT 1;',
      '0009_b.sql': 'SELECT 1;',
      '0009_c.sql': 'SELECT 1;',
    });
    await expect(loadMigrations(dir)).rejects.toThrow(/duplicate migration prefix.*0009/i);
  });

  it('does not flag distinct prefixes', async () => {
    const dir = await makeDir({
      '0008_one.sql': 'SELECT 1;',
      '0009_two.sql': 'SELECT 1;',
      '0010_three.sql': 'SELECT 1;',
    });
    const list = await loadMigrations(dir);
    expect(list.map((m) => m.name)).toEqual(['0008_one.sql', '0009_two.sql', '0010_three.sql']);
  });

  it('ignores files that do not match the NNNN_ prefix shape', async () => {
    // README.md / non-migration files in `migrations/` should be passed
    // through (they're filtered to .sql) without provoking the prefix check.
    // A `.sql` file without a leading `NNNN_` is unusual but should not crash
    // the collision check — it just isn't part of any prefix bucket.
    const dir = await makeDir({
      '0001_real.sql': 'SELECT 1;',
      'rollback-helper.sql': 'SELECT 1;',
    });
    const list = await loadMigrations(dir);
    expect(list.map((m) => m.name).sort()).toEqual([
      '0001_real.sql',
      'rollback-helper.sql',
    ]);
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

describe('wave/56 — 0008_record_legacy_renames.sql against the live migrations dir', () => {
  // Belt-and-braces integration: replay the bookkeeping migration against a
  // pre-stamped tenant and make sure the renamed 0009..0012 files are
  // skipped on the next run. This guards against the wave/56 SEV-1 root
  // cause being silently re-introduced by a future renumber that forgets
  // the rename-bookkeeping step.
  let db: Client;

  beforeEach(async () => {
    db = await openMemoryDb();
  });

  it('a tenant pre-stamped with the legacy 0005/0006 names skips the renamed files', async () => {
    // Simulate a tenant that already applied the OLD-named migrations on a
    // prior run (the actual schema state isn't relevant — `runMigrations`
    // only consults `_migrations.name`).
    await db.execute(
      `CREATE TABLE IF NOT EXISTS "_migrations" (
        "name" TEXT PRIMARY KEY,
        "applied_at" TEXT NOT NULL
      )`,
    );
    const stamp = '2026-04-30T00:00:00.000Z';
    for (const legacy of [
      '0005_camp_mob_species.sql',
      '0005_sars_livestock_election.sql',
      '0006_aia_tag_fields.sql',
      '0006_farmsettings_tax_ref_number.sql',
    ]) {
      await db.execute({
        sql: `INSERT INTO "_migrations" (name, applied_at) VALUES (?, ?)`,
        args: [legacy, stamp],
      });
    }

    // Load only the rename-bookkeeping file from a temp dir mirroring the
    // real `migrations/` content for this assertion.
    const repoRoot = join(__dirname, '..', '..');
    const realDir = join(repoRoot, 'migrations');
    const all = await loadMigrations(realDir);
    const recorder = all.find(
      (m) => m.name === '0008_record_legacy_renames.sql',
    );
    expect(recorder, 'rename-bookkeeping file must exist').toBeTruthy();

    // Run the rename-bookkeeping plus the four renamed files. Because
    // 0008_record_legacy_renames.sql runs FIRST (sort order), the four
    // renamed files must be in `_migrations` already by the time
    // runMigrations gets to them, and so must be skipped.
    const subset = all.filter((m) =>
      [
        '0008_record_legacy_renames.sql',
        '0009_camp_mob_species.sql',
        '0010_sars_livestock_election.sql',
        '0011_aia_tag_fields.sql',
        '0012_farmsettings_tax_ref_number.sql',
      ].includes(m.name),
    );
    expect(subset).toHaveLength(5);

    const result = await runMigrations(db, subset);

    // The bookkeeping file itself is the only thing actually applied.
    expect(result.applied).toEqual(['0008_record_legacy_renames.sql']);
    expect(result.skipped.sort()).toEqual([
      '0009_camp_mob_species.sql',
      '0010_sars_livestock_election.sql',
      '0011_aia_tag_fields.sql',
      '0012_farmsettings_tax_ref_number.sql',
    ]);

    // Final `_migrations` state holds BOTH the legacy and the new names —
    // the legacy rows from the seed plus the new-name rows inserted by
    // 0008_record_legacy_renames.sql.
    const recorded = await db.execute(
      `SELECT name FROM "_migrations" ORDER BY name`,
    );
    expect(recorded.rows.map((r) => r.name)).toEqual([
      '0005_camp_mob_species.sql',
      '0005_sars_livestock_election.sql',
      '0006_aia_tag_fields.sql',
      '0006_farmsettings_tax_ref_number.sql',
      '0008_record_legacy_renames.sql',
      '0009_camp_mob_species.sql',
      '0010_sars_livestock_election.sql',
      '0011_aia_tag_fields.sql',
      '0012_farmsettings_tax_ref_number.sql',
    ]);
  });

  it('a fresh tenant (no legacy rows) skips the rename-bookkeeping no-op and runs the renamed files normally', async () => {
    // The WHERE EXISTS guard means INSERT OR IGNORE is a true no-op for a
    // fresh clone. The renamed 0009..0012 files must then be applied normally
    // (we don't actually exercise their schema here — that's covered by the
    // dedicated migration-camp-mob-species suite — only the bookkeeping
    // contract).
    const repoRoot = join(__dirname, '..', '..');
    const realDir = join(repoRoot, 'migrations');
    const all = await loadMigrations(realDir);
    const bookkeeping = all.find(
      (m) => m.name === '0008_record_legacy_renames.sql',
    )!;

    // Empty `_migrations` table — fresh tenant.
    await runMigrations(db, [bookkeeping]);
    const recorded = await db.execute(
      `SELECT name FROM "_migrations" ORDER BY name`,
    );
    // Only the bookkeeping file itself ends up applied; the four conditional
    // INSERTs all WHERE-EXISTS-fail.
    expect(recorded.rows.map((r) => r.name)).toEqual([
      '0008_record_legacy_renames.sql',
    ]);
  });
});

describe('wave/130 — 0016/0017 Animal.species pre-stamp against the live migrations dir', () => {
  // Background: pre-rule-tightening tenants got `Animal.species` and
  // `Animal.speciesData` via legacy `prisma db push`. After CLAUDE.md banned
  // hand-rolled migrations / `prisma db push` (2026-04-28), `basson-boerdery`
  // was provisioned and never received those columns — every Prisma query
  // projecting `species` (notably the dashboard helper) crashed 500.
  //
  // Fix: 0016 pre-stamps 0017 as applied for tenants that already have the
  // `species` column. 0017 ALTERs the table for tenants missing it. These
  // tests guard the contract:
  //   - tenants WITH the column → 0016 marks 0017 applied; 0017 is skipped
  //   - tenants WITHOUT the column → 0016 inserts nothing; 0017 runs ALTER
  let db: Client;

  beforeEach(async () => {
    db = await openMemoryDb();
  });

  it('a tenant that already has Animal.species skips 0017 and the ALTER never runs', async () => {
    // Seed an Animal table that ALREADY has species + speciesData — the
    // pre-rule-tightening cohort. Other Animal columns are stubbed; only the
    // species columns matter for the pragma_table_info probe.
    await db.execute(`
      CREATE TABLE "Animal" (
        id TEXT PRIMARY KEY,
        species TEXT NOT NULL DEFAULT 'cattle',
        speciesData TEXT
      )
    `);

    const repoRoot = join(__dirname, '..', '..');
    const realDir = join(repoRoot, 'migrations');
    const all = await loadMigrations(realDir);
    const pair = all.filter((m) =>
      [
        '0016_pre_stamp_animal_species_columns.sql',
        '0017_animal_species_columns.sql',
      ].includes(m.name),
    );
    expect(pair).toHaveLength(2);

    const result = await runMigrations(db, pair);

    // 0016 itself is applied (the bookkeeping migration always runs); 0017
    // is skipped because 0016 stamped it.
    expect(result.applied).toEqual(['0016_pre_stamp_animal_species_columns.sql']);
    expect(result.skipped).toEqual(['0017_animal_species_columns.sql']);

    // Both names land in `_migrations`.
    const recorded = await db.execute(
      `SELECT name FROM "_migrations" ORDER BY name`,
    );
    expect(recorded.rows.map((r) => r.name)).toEqual([
      '0016_pre_stamp_animal_species_columns.sql',
      '0017_animal_species_columns.sql',
    ]);

    // The ALTER did not re-fire — column count unchanged. (If 0017 had run,
    // the ALTER would have failed on "duplicate column" and the whole batch
    // would have rolled back, so this assertion is belt-and-braces.)
    const cols = await db.execute(`PRAGMA table_info("Animal")`);
    const names = cols.rows.map((r) => r.name as string).sort();
    expect(names).toEqual(['id', 'species', 'speciesData']);
  });

  it('a fresh tenant missing Animal.species applies 0017 and the columns are added', async () => {
    // Seed an Animal table WITHOUT species — the basson cohort.
    await db.execute(`CREATE TABLE "Animal" ( id TEXT PRIMARY KEY )`);

    const repoRoot = join(__dirname, '..', '..');
    const realDir = join(repoRoot, 'migrations');
    const all = await loadMigrations(realDir);
    const pair = all.filter((m) =>
      [
        '0016_pre_stamp_animal_species_columns.sql',
        '0017_animal_species_columns.sql',
      ].includes(m.name),
    );

    const result = await runMigrations(db, pair);

    // Both files apply: 0016 inserts nothing (WHERE EXISTS is false) and
    // 0017 actually ALTERs the table.
    expect(result.applied).toEqual([
      '0016_pre_stamp_animal_species_columns.sql',
      '0017_animal_species_columns.sql',
    ]);
    expect(result.skipped).toEqual([]);

    // Both columns landed.
    const cols = await db.execute(`PRAGMA table_info("Animal")`);
    const names = cols.rows.map((r) => r.name as string).sort();
    expect(names).toEqual(['id', 'species', 'speciesData']);

    // Default for `species` is the literal 'cattle' — match Prisma's default.
    await db.execute(`INSERT INTO "Animal" (id) VALUES ('A1')`);
    const sample = await db.execute(`SELECT species, speciesData FROM "Animal"`);
    expect(sample.rows[0].species).toBe('cattle');
    expect(sample.rows[0].speciesData).toBeNull();
  });

  it('replaying 0016/0017 on an already-migrated tenant is a no-op', async () => {
    // Idempotency check: after the first run leaves both rows in _migrations,
    // a second runMigrations call must produce 0 applied + 2 skipped.
    await db.execute(`CREATE TABLE "Animal" ( id TEXT PRIMARY KEY )`);

    const repoRoot = join(__dirname, '..', '..');
    const realDir = join(repoRoot, 'migrations');
    const all = await loadMigrations(realDir);
    const pair = all.filter((m) =>
      [
        '0016_pre_stamp_animal_species_columns.sql',
        '0017_animal_species_columns.sql',
      ].includes(m.name),
    );

    await runMigrations(db, pair);
    const second = await runMigrations(db, pair);

    expect(second.applied).toEqual([]);
    expect(second.skipped.sort()).toEqual([
      '0016_pre_stamp_animal_species_columns.sql',
      '0017_animal_species_columns.sql',
    ]);
  });
});

describe('wave/132 — 0014_einstein_chunker_version constant-default rewrite', () => {
  // Background: the original 0014 used `DEFAULT CURRENT_TIMESTAMP` on three
  // ALTER TABLE ADD COLUMN statements (Camp.updatedAt, Animal.updatedAt,
  // Task.updatedAt). Turso/libSQL rejects this — `CURRENT_TIMESTAMP` is a
  // non-constant default and SQLite's ADD COLUMN parser only accepts
  // constant expressions. The migration silently failed on trio-b and
  // basson during Wave 0 stress testing — the migrator threw, the
  // `_migrations` row was never written, and every Prisma `findMany()`
  // SELECTing `updatedAt` crashed with `no such column`. That's the
  // C1/C3 root cause from the 2026-05-06 stress test report.
  //
  // The fix: ADD COLUMN with a constant literal default
  // ('1970-01-01 00:00:00'), then immediately UPDATE every row to
  // CURRENT_TIMESTAMP — same value Prisma's `@updatedAt` writes on insert.
  //
  // These tests guard the contract:
  //   1. A fresh tenant gets all four columns + the chunker columns +
  //      backfilled CURRENT_TIMESTAMP timestamps (not the sentinel).
  //   2. Replaying 0014 on a tenant that already applied it is a no-op
  //      (the migrator's `_migrations` row check skips the file).
  let db: Client;

  beforeEach(async () => {
    db = await openMemoryDb();
  });

  it('a fresh tenant gets all 0014 columns with backfilled timestamps (not the sentinel)', async () => {
    // Seed the four tables 0014 ALTERs, with a row in each so the UPDATE
    // backfill has something to touch. Schemas are stubbed to the minimum
    // ALTER targets — only the columns 0014 adds matter here.
    await db.execute(`CREATE TABLE "EinsteinChunk" ( id TEXT PRIMARY KEY )`);
    await db.execute(`CREATE TABLE "Camp"  ( id TEXT PRIMARY KEY )`);
    await db.execute(`CREATE TABLE "Animal"( id TEXT PRIMARY KEY )`);
    await db.execute(`CREATE TABLE "Task"  ( id TEXT PRIMARY KEY )`);
    await db.execute(`INSERT INTO "Camp"   (id) VALUES ('camp-1')`);
    await db.execute(`INSERT INTO "Animal" (id) VALUES ('animal-1')`);
    await db.execute(`INSERT INTO "Task"   (id) VALUES ('task-1')`);

    const repoRoot = join(__dirname, '..', '..');
    const realDir = join(repoRoot, 'migrations');
    const all = await loadMigrations(realDir);
    const only = all.filter((m) => m.name === '0014_einstein_chunker_version.sql');
    expect(only).toHaveLength(1);

    const result = await runMigrations(db, only);

    expect(result.applied).toEqual(['0014_einstein_chunker_version.sql']);
    expect(result.skipped).toEqual([]);

    // All five new columns landed across the four tables.
    const chunkerCols = await db.execute(`PRAGMA table_info("EinsteinChunk")`);
    expect(chunkerCols.rows.map((r) => r.name as string).sort()).toEqual(
      ['chunkerVersion', 'contentHash', 'id'],
    );
    const campCols = await db.execute(`PRAGMA table_info("Camp")`);
    expect(campCols.rows.map((r) => r.name as string).sort()).toEqual(['id', 'updatedAt']);
    const animalCols = await db.execute(`PRAGMA table_info("Animal")`);
    expect(animalCols.rows.map((r) => r.name as string).sort()).toEqual(['id', 'updatedAt']);
    const taskCols = await db.execute(`PRAGMA table_info("Task")`);
    expect(taskCols.rows.map((r) => r.name as string).sort()).toEqual(['id', 'updatedAt']);

    // The UPDATE backfill replaced the sentinel with CURRENT_TIMESTAMP for
    // existing rows — so the seeded row's updatedAt is NOT '1970-01-01...'.
    // (This is what proves the rewrite actually backfills, not just adds
    // the column with a useless sentinel value.)
    const camp = await db.execute(`SELECT updatedAt FROM "Camp" WHERE id = 'camp-1'`);
    expect(camp.rows[0].updatedAt).not.toBe('1970-01-01 00:00:00');
    expect(camp.rows[0].updatedAt).not.toBeNull();
    const animal = await db.execute(`SELECT updatedAt FROM "Animal" WHERE id = 'animal-1'`);
    expect(animal.rows[0].updatedAt).not.toBe('1970-01-01 00:00:00');
    expect(animal.rows[0].updatedAt).not.toBeNull();
    const task = await db.execute(`SELECT updatedAt FROM "Task" WHERE id = 'task-1'`);
    expect(task.rows[0].updatedAt).not.toBe('1970-01-01 00:00:00');
    expect(task.rows[0].updatedAt).not.toBeNull();
  });

  it('replaying 0014 on an already-migrated tenant is a no-op', async () => {
    await db.execute(`CREATE TABLE "EinsteinChunk" ( id TEXT PRIMARY KEY )`);
    await db.execute(`CREATE TABLE "Camp"  ( id TEXT PRIMARY KEY )`);
    await db.execute(`CREATE TABLE "Animal"( id TEXT PRIMARY KEY )`);
    await db.execute(`CREATE TABLE "Task"  ( id TEXT PRIMARY KEY )`);

    const repoRoot = join(__dirname, '..', '..');
    const realDir = join(repoRoot, 'migrations');
    const all = await loadMigrations(realDir);
    const only = all.filter((m) => m.name === '0014_einstein_chunker_version.sql');

    await runMigrations(db, only);
    const second = await runMigrations(db, only);

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0014_einstein_chunker_version.sql']);
  });

  it('rejects the legacy non-constant-default form (regression guard)', async () => {
    // This test pins the rule that 0014 must NOT use `DEFAULT CURRENT_TIMESTAMP`
    // on ALTER TABLE ADD COLUMN. Reading the actual file, asserting it does
    // NOT contain the rejected pattern. If a future contributor reverts the
    // rewrite, this fires.
    const repoRoot = join(__dirname, '..', '..');
    const realDir = join(repoRoot, 'migrations');
    const all = await loadMigrations(realDir);
    const only = all.find((m) => m.name === '0014_einstein_chunker_version.sql');
    expect(only).toBeDefined();
    // The rejected pattern: any `ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP`.
    expect(only!.sql).not.toMatch(/ADD COLUMN[^;]+DEFAULT\s+CURRENT_TIMESTAMP/i);
    // The fix shape: at least one UPDATE...CURRENT_TIMESTAMP backfill.
    expect(only!.sql).toMatch(/UPDATE\s+"[^"]+"\s+SET\s+"updatedAt"\s+=\s+CURRENT_TIMESTAMP/i);
  });
});
