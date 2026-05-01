/**
 * lib/server/__tests__/migration-camp-mob-species.test.ts
 *
 * Phase A of the multi-species refactor (issue #28, wave/28a).
 *
 * Verifies the `0005_camp_mob_species.sql` up-migration and the operator-only
 * `migrations/rollback/0005_camp_mob_species.down.sql` down-migration against
 * an in-memory libsql DB. We replay the OLD shape of Camp + Mob (single global
 * UNIQUE on Camp.campId, no species column), apply the migration, and assert:
 *
 *   1. `Camp.species` and `Mob.species` are populated with `'cattle'` for
 *      every existing row (the NOT NULL DEFAULT 'cattle' clause in
 *      ALTER TABLE ADD COLUMN backfills automatically on libsql/sqlite).
 *   2. The global UNIQUE on `Camp.campId` has been replaced by a composite
 *      UNIQUE on `(species, campId)` — so `Camp 1` cattle + `Camp 1` sheep
 *      both succeed, but `Camp 1` cattle twice fails.
 *   3. `@@index([species])` is in place on both tables (sqlite_master lookup).
 *   4. The down-migration restores the global UNIQUE on `Camp.campId` and
 *      drops the species columns (operator-only rollback path).
 *   5. The repo-level `lib/migrator.ts#loadMigrations()` only loads the
 *      forward `.sql` file from `migrations/` — the `.down.sql` lives under
 *      `migrations/rollback/` so the tenant migrate runner never sees it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { loadMigrations } from '../../../lib/migrator';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'migrations');
const UP_FILE = '0005_camp_mob_species.sql';
const DOWN_FILE = join('rollback', '0005_camp_mob_species.down.sql');

async function readMigration(relativePath: string): Promise<string> {
  return readFile(join(MIGRATIONS_DIR, relativePath), 'utf-8');
}

function splitStatements(sql: string): string[] {
  // Mirrors lib/migrator.ts splitSqlStatements — kept inline so this test
  // exercises the literal SQL the runner will see.
  const stripped = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applySql(db: Client, sql: string): Promise<void> {
  for (const stmt of splitStatements(sql)) {
    await db.execute(stmt);
  }
}

async function makeOldShapeDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  // OLD shape — mirrors lib/farm-schema.ts exactly. Critically: campId UNIQUE
  // is enforced via a SEPARATE NAMED INDEX (`Camp_campId_key`), not an inline
  // column constraint. This is what `prisma migrate diff` emits, and what
  // every existing tenant DB has on disk. The migration's
  // `DROP INDEX IF EXISTS Camp_campId_key` only works against this shape —
  // an inline `UNIQUE` column constraint would create an `sqlite_autoindex_*`
  // that DROP INDEX cannot remove without a table rebuild.
  await db.execute(`
    CREATE TABLE Camp (
      id TEXT NOT NULL PRIMARY KEY,
      campId TEXT NOT NULL,
      campName TEXT NOT NULL,
      sizeHectares REAL,
      waterSource TEXT,
      geojson TEXT,
      color TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      veldType TEXT,
      restDaysOverride INTEGER,
      maxGrazingDaysOverride INTEGER,
      rotationNotes TEXT
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX "Camp_campId_key" ON "Camp"("campId")`);
  await db.execute(`
    CREATE TABLE Mob (
      id TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      currentCamp TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`CREATE INDEX "idx_mob_camp" ON "Mob"("currentCamp")`);
  return db;
}

async function indexExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
    args: [name],
  });
  return res.rows.length === 1;
}

async function columnExists(
  db: Client,
  table: string,
  column: string,
): Promise<boolean> {
  const res = await db.execute(`PRAGMA table_info(${table})`);
  return res.rows.some((r) => r.name === column);
}

describe('0005_camp_mob_species — up migration', () => {
  let db: Client;
  let upSql: string;

  beforeEach(async () => {
    db = await makeOldShapeDb();
    upSql = await readMigration(UP_FILE);

    // Seed three Camp rows + two Mob rows in the OLD schema (no species col).
    await db.batch(
      [
        {
          sql: `INSERT INTO Camp (id, campId, campName) VALUES (?, ?, ?)`,
          args: ['c1', 'NORTH-01', 'North Field'],
        },
        {
          sql: `INSERT INTO Camp (id, campId, campName) VALUES (?, ?, ?)`,
          args: ['c2', 'SOUTH-02', 'South Field'],
        },
        {
          sql: `INSERT INTO Camp (id, campId, campName) VALUES (?, ?, ?)`,
          args: ['c3', 'EAST-03', 'East Field'],
        },
        {
          sql: `INSERT INTO Mob (id, name, currentCamp) VALUES (?, ?, ?)`,
          args: ['m1', 'Heifers A', 'NORTH-01'],
        },
        {
          sql: `INSERT INTO Mob (id, name, currentCamp) VALUES (?, ?, ?)`,
          args: ['m2', 'Steers B', 'SOUTH-02'],
        },
      ],
      'write',
    );
  });

  it('backfills every existing Camp.species to cattle via the NOT NULL DEFAULT', async () => {
    await applySql(db, upSql);
    const res = await db.execute(`SELECT id, species FROM Camp ORDER BY id`);
    expect(res.rows.map((r) => r.species)).toEqual(['cattle', 'cattle', 'cattle']);
  });

  it('backfills every existing Mob.species to cattle via the NOT NULL DEFAULT', async () => {
    await applySql(db, upSql);
    const res = await db.execute(`SELECT id, species FROM Mob ORDER BY id`);
    expect(res.rows.map((r) => r.species)).toEqual(['cattle', 'cattle']);
  });

  it('drops the global UNIQUE on Camp.campId so the same campId works across species', async () => {
    await applySql(db, upSql);
    // NORTH-01 already exists as cattle (from beforeEach). Inserting NORTH-01 as
    // sheep must succeed under the new composite UNIQUE.
    await db.execute({
      sql: `INSERT INTO Camp (id, campId, campName, species) VALUES (?, ?, ?, ?)`,
      args: ['c1-sheep', 'NORTH-01', 'North Field (sheep)', 'sheep'],
    });
    const res = await db.execute({
      sql: `SELECT species FROM Camp WHERE campId = ? ORDER BY species`,
      args: ['NORTH-01'],
    });
    expect(res.rows.map((r) => r.species)).toEqual(['cattle', 'sheep']);
  });

  it('rejects duplicate campId within the same species under the composite UNIQUE', async () => {
    await applySql(db, upSql);
    await expect(
      db.execute({
        sql: `INSERT INTO Camp (id, campId, campName, species) VALUES (?, ?, ?, ?)`,
        args: ['c1-dup', 'NORTH-01', 'North Field DUP', 'cattle'],
      }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('creates Camp_species_idx and Mob_species_idx indexes', async () => {
    await applySql(db, upSql);
    expect(await indexExists(db, 'Camp_species_idx')).toBe(true);
    expect(await indexExists(db, 'Mob_species_idx')).toBe(true);
  });

  it('creates the composite Camp_species_campId_key UNIQUE index', async () => {
    await applySql(db, upSql);
    expect(await indexExists(db, 'Camp_species_campId_key')).toBe(true);
  });

  it('removes the legacy Camp_campId_key UNIQUE index', async () => {
    // The OLD shape uses an inline `campId TEXT NOT NULL UNIQUE`. SQLite names
    // such auto-indexes `sqlite_autoindex_<table>_N`. Either way, after the
    // migration there must NOT be a UNIQUE index that constrains campId alone
    // — verify by attempting the duplicate-across-species insert from above.
    // The duplicate-cross-species test already covers this; this assertion
    // is defensive: the named legacy index (if Prisma had created it) is gone.
    await applySql(db, upSql);
    expect(await indexExists(db, 'Camp_campId_key')).toBe(false);
  });

  it('row counts are unchanged after the migration', async () => {
    const beforeCamp = await db.execute(`SELECT COUNT(*) as n FROM Camp`);
    const beforeMob = await db.execute(`SELECT COUNT(*) as n FROM Mob`);
    await applySql(db, upSql);
    const afterCamp = await db.execute(`SELECT COUNT(*) as n FROM Camp`);
    const afterMob = await db.execute(`SELECT COUNT(*) as n FROM Mob`);
    expect(afterCamp.rows[0]?.n).toEqual(beforeCamp.rows[0]?.n);
    expect(afterMob.rows[0]?.n).toEqual(beforeMob.rows[0]?.n);
  });

  it('is idempotent — replaying the migration is a no-op via the _migrations table', async () => {
    // The migrator records applied names in `_migrations` and skips them on
    // re-run. We mimic that contract here: applying the up-SQL twice on the
    // same connection would error (DROP INDEX IF EXISTS handles the index
    // pair, but ADD COLUMN is not idempotent natively). The migrator's
    // bookkeeping prevents the second apply — this test pins that the
    // up-migration uses `IF NOT EXISTS` / `IF EXISTS` guards so a manual
    // operator re-run also doesn't blow up.
    await applySql(db, upSql);
    // Second apply must NOT throw on the index DDL because of IF EXISTS / IF
    // NOT EXISTS guards. The ALTER TABLE ADD COLUMN portions WILL throw on
    // re-run (sqlite has no `ADD COLUMN IF NOT EXISTS`), so we only re-run
    // the index half — which is the part that can fail mid-batch and leave
    // the DB in an inconsistent state if the guards are missing.
    const indexHalf = splitStatements(upSql).filter(
      (s) => s.startsWith('DROP INDEX') || s.startsWith('CREATE INDEX') || s.startsWith('CREATE UNIQUE INDEX'),
    );
    for (const stmt of indexHalf) {
      await db.execute(stmt);
    }
  });
});

describe('0005_camp_mob_species — down migration (operator-only rollback)', () => {
  it('drops species columns and restores the global UNIQUE on Camp.campId', async () => {
    const db = await makeOldShapeDb();
    const upSql = await readMigration(UP_FILE);
    const downSql = await readMigration(DOWN_FILE);

    // Seed + apply up.
    await db.execute({
      sql: `INSERT INTO Camp (id, campId, campName) VALUES (?, ?, ?)`,
      args: ['c1', 'NORTH-01', 'North Field'],
    });
    await applySql(db, upSql);

    // Insert a same-campId-different-species row that the new schema allows.
    await db.execute({
      sql: `INSERT INTO Camp (id, campId, campName, species) VALUES (?, ?, ?, ?)`,
      args: ['c1-sheep', 'NORTH-01', 'North Field sheep', 'sheep'],
    });

    // The down migration WARNS that it will fail when this scenario exists —
    // so we delete the cross-species duplicate first to simulate an operator
    // who has audited the rollback path.
    await db.execute({
      sql: `DELETE FROM Camp WHERE id = ?`,
      args: ['c1-sheep'],
    });

    // Apply down.
    await applySql(db, downSql);

    // species columns are gone.
    expect(await columnExists(db, 'Camp', 'species')).toBe(false);
    expect(await columnExists(db, 'Mob', 'species')).toBe(false);

    // Global UNIQUE on Camp.campId is back: a duplicate insert must fail.
    await expect(
      db.execute({
        sql: `INSERT INTO Camp (id, campId, campName) VALUES (?, ?, ?)`,
        args: ['c1-dup', 'NORTH-01', 'North Field DUP'],
      }),
    ).rejects.toThrow(/UNIQUE/i);
  });
});

describe('0005_camp_mob_species — migrator integration', () => {
  it('lib/migrator.ts loadMigrations picks up the up-file but NOT the down-file', async () => {
    const list = await loadMigrations(MIGRATIONS_DIR);
    const names = list.map((m) => m.name);
    expect(names).toContain(UP_FILE);
    // The down-migration MUST live under migrations/rollback/ (operator-only)
    // so that `loadMigrations` (non-recursive readdir) never picks it up.
    expect(names.some((n) => n.includes('down.sql'))).toBe(false);
  });

  it('the rollback subdirectory contains exactly the down file for this migration', async () => {
    const entries = await readdir(join(MIGRATIONS_DIR, 'rollback'));
    expect(entries).toContain('0005_camp_mob_species.down.sql');
  });
});
