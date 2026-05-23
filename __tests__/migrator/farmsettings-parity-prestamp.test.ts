/**
 * Locks the 2026-05-16 incident regression: 0022_farmsettings_parity.sql did a
 * plain ADD COLUMN that threw `duplicate column name` on every prod tenant
 * (columns pre-existed via legacy `prisma db push`), jamming the promote
 * pipeline. The fix splits it into a pre-stamp (0022) + renamed DDL (0023)
 * mirroring the proven 0016/0017 pattern.
 *
 * Runs the real migration files against an in-memory libsql DB so we exercise
 * the actual SQL, not a paraphrase.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { loadMigrations, runMigrations } from '../../lib/migrator';

const MIG_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));
const PRESTAMP = '0022_pre_stamp_farmsettings_parity.sql';
const DDL = '0023_farmsettings_parity.sql';

async function tempMigrationsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fs-parity-'));
  for (const name of [PRESTAMP, DDL]) {
    await writeFile(join(dir, name), await readFile(join(MIG_DIR, name), 'utf-8'), 'utf-8');
  }
  return dir;
}

async function appliedNames(db: Client): Promise<Set<string>> {
  const r = await db.execute(`SELECT name FROM "_migrations"`);
  return new Set(r.rows.map((x) => x.name as string));
}
async function columns(db: Client): Promise<Set<string>> {
  const r = await db.execute(`SELECT name FROM pragma_table_info('FarmSettings')`);
  return new Set(r.rows.map((x) => x.name as string));
}

describe('FarmSettings parity pre-stamp split (#280 / 2026-05-16 incident)', () => {
  it('drifted tenant: pre-stamp skips the DDL — no duplicate-column error', async () => {
    const db = createClient({ url: ':memory:' });
    // Simulate the db-push'd cohort: FarmSettings already carries `timezone`.
    await db.execute(`CREATE TABLE "FarmSettings" ("id" TEXT PRIMARY KEY, "timezone" TEXT)`);
    const dir = await tempMigrationsDir();

    // The whole point: this must NOT throw `duplicate column name`.
    await expect(runMigrations(db, await loadMigrations(dir))).resolves.toBeDefined();

    const applied = await appliedNames(db);
    expect(applied.has(PRESTAMP)).toBe(true);
    expect(applied.has(DDL)).toBe(true); // pre-stamped, not DDL-applied
    // DDL was SKIPPED, so its columns were not added by this run.
    const cols = await columns(db);
    expect(cols.has('timezone')).toBe(true); // pre-existing
    expect(cols.has('defaultRestDays')).toBe(false); // proves 0023 DDL did not run
    db.close();
  });

  it('fresh tenant: pre-stamp inserts nothing, DDL runs and adds all columns', async () => {
    const db = createClient({ url: ':memory:' });
    await db.execute(`CREATE TABLE "FarmSettings" ("id" TEXT PRIMARY KEY)`);
    const dir = await tempMigrationsDir();

    await expect(runMigrations(db, await loadMigrations(dir))).resolves.toBeDefined();

    const applied = await appliedNames(db);
    expect(applied.has(PRESTAMP)).toBe(true);
    expect(applied.has(DDL)).toBe(true); // DDL genuinely applied
    const cols = await columns(db);
    for (const c of ['timezone', 'defaultRestDays', 'aiSettings', 'onboardingComplete']) {
      expect(cols.has(c)).toBe(true);
    }
    db.close();
  });

  it('idempotent: re-running after both recorded is a clean no-op', async () => {
    const db = createClient({ url: ':memory:' });
    await db.execute(`CREATE TABLE "FarmSettings" ("id" TEXT PRIMARY KEY, "timezone" TEXT)`);
    const dir = await tempMigrationsDir();
    const migrations = await loadMigrations(dir);
    await runMigrations(db, migrations);
    await expect(runMigrations(db, migrations)).resolves.toBeDefined();
    db.close();
  });
});
