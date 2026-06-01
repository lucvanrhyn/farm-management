import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { describe, it, expect, afterEach } from 'vitest';
import { FARM_SCHEMA_SQL, BASELINE_MIGRATION_NAMES } from '../lib/farm-schema';
import { stampMigrationsApplied, loadMigrations, runMigrations } from '../lib/migrator';
import {
  parsePrismaSchema,
  expectedColumnsByTable,
} from '../lib/ops/parse-prisma-schema';

/**
 * Guards the #280 / H0b onboarding-drift class: a freshly provisioned tenant
 * must get every table/column prisma/schema.prisma declares. We apply the real
 * bootstrap DDL to an in-memory libSQL engine (the same engine Turso runs) and
 * assert completeness against the Prisma source of truth.
 *
 * This is the behavioural complement to `pnpm db:gen-schema:check` (byte-level
 * staleness): it proves the generated SQL actually *applies* and that the seed
 * path's stamping makes migrations a no-op.
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function prismaTables(): string[] {
  const src = readFileSync(join(REPO_ROOT, 'prisma', 'schema.prisma'), 'utf-8');
  return [...expectedColumnsByTable(parsePrismaSchema(src)).keys()];
}

async function tablesIn(db: Client): Promise<Set<string>> {
  const res = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
  );
  return new Set(res.rows.map((r) => r.name as string));
}

let db: Client;
afterEach(() => {
  db?.close();
});

describe('seedFarmDatabase bootstrap completeness', () => {
  // EinsteinChunk is deliberately operator-provisioned (libSQL F32_BLOB +
  // vector index that Prisma can't emit) — see gen-farm-schema.ts EXCLUDE_TABLES.
  const BOOTSTRAP_EXCLUDED = new Set(['EinsteinChunk']);

  it('FARM_SCHEMA_SQL applies cleanly and creates every prisma-declared table (bar operator-provisioned ones)', async () => {
    db = createClient({ url: ':memory:' });
    await db.executeMultiple(FARM_SCHEMA_SQL);

    const live = await tablesIn(db);
    const missing = prismaTables().filter(
      (t) => !live.has(t) && !BOOTSTRAP_EXCLUDED.has(t),
    );
    expect(missing, `tables declared in prisma but not created by bootstrap: ${missing.join(', ')}`).toEqual([]);

    // The exclusion is intentional and narrow — assert it really is absent so a
    // future accidental inclusion (with Prisma's wrong plain-BLOB DDL) is caught.
    expect(live.has('EinsteinChunk'), 'EinsteinChunk must stay operator-provisioned').toBe(false);
  });

  it('creates the tables/columns the onboarding flow needs (ImportJob, Observation)', async () => {
    db = createClient({ url: ':memory:' });
    await db.executeMultiple(FARM_SCHEMA_SQL);

    // ImportJob backs the CSV/herd import wizard — its absence was the live 500.
    const importJob = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='ImportJob'`,
    );
    expect(importJob.rows.length).toBe(1);

    // Observation must carry the columns added by later migrations.
    const cols = await db.execute(`SELECT name FROM pragma_table_info('Observation')`);
    const colNames = new Set(cols.rows.map((r) => r.name as string));
    for (const c of ['species', 'clientLocalId', 'carcassDisposal', 'notes']) {
      expect(colNames.has(c), `Observation.${c} missing`).toBe(true);
    }
  });

  it('seed INSERT into FarmSettings succeeds against the regenerated schema', async () => {
    db = createClient({ url: ':memory:' });
    await db.executeMultiple(FARM_SCHEMA_SQL);
    await db.execute({
      sql: `INSERT INTO FarmSettings (id, farmName, breed, updatedAt)
            VALUES ('singleton', ?, 'Mixed', datetime('now'))`,
      args: ['Test Farm'],
    });
    const row = await db.execute(`SELECT farmName FROM FarmSettings WHERE id='singleton'`);
    expect(row.rows[0]?.farmName).toBe('Test Farm');
  });

  it('stamps every baseline migration so a later db:migrate is a no-op', async () => {
    db = createClient({ url: ':memory:' });
    await db.executeMultiple(FARM_SCHEMA_SQL);
    await stampMigrationsApplied(db, BASELINE_MIGRATION_NAMES);

    const stamped = await db.execute(`SELECT count(*) AS n FROM "_migrations"`);
    expect(Number(stamped.rows[0]?.n)).toBe(BASELINE_MIGRATION_NAMES.length);

    // Running the real migration set must skip all of them (none re-applied).
    const migrations = await loadMigrations(join(REPO_ROOT, 'migrations'));
    const result = await runMigrations(db, migrations);
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBe(migrations.length);
  });

  it('BASELINE_MIGRATION_NAMES matches the migrations/ directory exactly', async () => {
    const onDisk = (await loadMigrations(join(REPO_ROOT, 'migrations'))).map((m) => m.name);
    expect([...BASELINE_MIGRATION_NAMES]).toEqual(onDisk);
  });
});
