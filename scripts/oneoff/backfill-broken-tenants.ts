/**
 * One-off: bring audit/test tenants to schema parity with a healthy prod tenant
 * (acme-cattle), so post-merge promote stops failing on them.
 *
 * Confirmed via inspect-tenant-data.ts that audit-farm / audit-test-farm /
 * test-farm hold only the FarmSettings singleton row plus a 3-row `_migrations`
 * bookkeeping table — no real tenant data. They were created at the
 * FARM_SCHEMA_SQL baseline and never received the 13 hand-rolled tables
 * (NvdRecord, TaskTemplate, etc.) nor migrations 0004-0012.
 *
 * Strategy (full reset):
 *   1. Read acme-cattle's sqlite_master DDL + _migrations rows
 *   2. For each broken tenant:
 *      a. Snapshot the FarmSettings.singleton.farmName so we don't lose it
 *      b. Drop every existing user table (skip internal sqlite_ and libsql_ objects)
 *      c. Replay basson's CREATE statements verbatim (tables → indexes → triggers → views)
 *      d. INSERT the FarmSettings singleton row with original farmName
 *      e. INSERT every basson `_migrations` row so the migrator skips them
 *
 * Run with:
 *   pnpm dotenv -e .env.local -- tsx scripts/oneoff/backfill-broken-tenants.ts
 *
 * Idempotent: safe to re-run. Each iteration drops + recreates the user tables.
 */
import { createClient, type Client } from '@libsql/client';
import { getFarmCreds } from '../../lib/meta-db';

const SOURCE_TENANT = 'acme-cattle';
const TARGET_TENANTS = ['audit-farm', 'audit-test-farm', 'test-farm'];

interface SchemaRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

const SKIP_NAME_PREFIXES = [
  'sqlite_',
  'libsql_',
  // Vector index shadow tables + their auto-indexes — libsql creates these
  // implicitly when the owning CREATE INDEX runs. Both `idx_einstein_chunk_vec_shadow`
  // (the table) and `idx_einstein_chunk_vec_shadow_idx` (the auto-index on it) appear
  // in sqlite_master and must NOT be created by hand.
  'idx_einstein_chunk_vec_shadow',
];

function shouldSkip(name: string): boolean {
  return SKIP_NAME_PREFIXES.some((p) => name.startsWith(p));
}

async function fetchSchema(db: Client): Promise<SchemaRow[]> {
  const res = await db.execute(
    `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name`,
  );
  return res.rows.map((r) => ({
    type: r.type as string,
    name: r.name as string,
    tbl_name: r.tbl_name as string,
    sql: r.sql as string | null,
  }));
}

async function fetchMigrationRows(
  db: Client,
): Promise<{ name: string; applied_at: string }[]> {
  const res = await db.execute(`SELECT name, applied_at FROM "_migrations" ORDER BY name`);
  return res.rows.map((r) => ({
    name: r.name as string,
    applied_at: r.applied_at as string,
  }));
}

async function getFarmName(db: Client): Promise<string | null> {
  try {
    const r = await db.execute(`SELECT farmName FROM FarmSettings WHERE id='singleton'`);
    return (r.rows[0]?.farmName as string) ?? null;
  } catch {
    return null;
  }
}

async function listUserTables(db: Client): Promise<string[]> {
  const r = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%'`,
  );
  return r.rows.map((row) => row.name as string).filter((n) => !shouldSkip(n));
}

async function dropAllUserTables(db: Client, slug: string): Promise<void> {
  const tables = await listUserTables(db);
  // Disable FK checks during the wipe so order doesn't matter.
  await db.execute(`PRAGMA foreign_keys = OFF`);
  for (const name of tables) {
    try {
      await db.execute(`DROP TABLE IF EXISTS "${name}"`);
    } catch (err) {
      console.error(`  [${slug}] failed to drop ${name}:`, err);
      throw err;
    }
  }
  await db.execute(`PRAGMA foreign_keys = ON`);
  console.log(`  [${slug}] dropped ${tables.length} table(s)`);
}

async function applySchema(
  db: Client,
  schema: SchemaRow[],
  slug: string,
): Promise<{ tables: number; indexes: number; triggers: number; views: number }> {
  const counts = { tables: 0, indexes: 0, triggers: 0, views: 0 };
  // Order: tables → indexes → triggers → views
  const ordered = [
    ...schema.filter((s) => s.type === 'table'),
    ...schema.filter((s) => s.type === 'index'),
    ...schema.filter((s) => s.type === 'trigger'),
    ...schema.filter((s) => s.type === 'view'),
  ];
  for (const obj of ordered) {
    if (shouldSkip(obj.name)) continue;
    if (!obj.sql) continue;
    try {
      await db.execute(obj.sql);
      if (obj.type === 'table') counts.tables++;
      else if (obj.type === 'index') counts.indexes++;
      else if (obj.type === 'trigger') counts.triggers++;
      else if (obj.type === 'view') counts.views++;
    } catch (err) {
      console.error(
        `  [${slug}] failed to create ${obj.type} ${obj.name}:`,
        err instanceof Error ? err.message : err,
      );
      console.error(`     sql: ${obj.sql}`);
      throw err;
    }
  }
  return counts;
}

async function main() {
  const sourceCreds = await getFarmCreds(SOURCE_TENANT);
  if (!sourceCreds) throw new Error(`no creds for source tenant ${SOURCE_TENANT}`);
  const sourceDb = createClient({
    url: sourceCreds.tursoUrl,
    authToken: sourceCreds.tursoAuthToken,
  });

  console.log(`[source] ${SOURCE_TENANT}: reading schema...`);
  const sourceSchema = await fetchSchema(sourceDb);
  const sourceMigrations = await fetchMigrationRows(sourceDb);
  sourceDb.close();
  console.log(
    `[source] ${SOURCE_TENANT}: ${sourceSchema.length} schema objects, ${sourceMigrations.length} _migrations rows`,
  );

  for (const tenant of TARGET_TENANTS) {
    console.log(`\n[target] ${tenant}`);
    const creds = await getFarmCreds(tenant);
    if (!creds) {
      console.warn(`  no creds in meta-db, skipping`);
      continue;
    }
    const db = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });

    try {
      const farmName = (await getFarmName(db)) ?? tenant;
      console.log(`  preserved farmName: "${farmName}"`);

      await dropAllUserTables(db, tenant);

      const counts = await applySchema(db, sourceSchema, tenant);
      console.log(
        `  applied schema: ${counts.tables} tables, ${counts.indexes} indexes, ${counts.triggers} triggers, ${counts.views} views`,
      );

      // FarmSettings singleton restore
      await db.execute({
        sql: `INSERT OR REPLACE INTO FarmSettings (id, farmName, breed, updatedAt)
              VALUES ('singleton', ?, 'Mixed', datetime('now'))`,
        args: [farmName],
      });
      console.log(`  restored FarmSettings.singleton`);

      // Stamp _migrations from source
      for (const m of sourceMigrations) {
        await db.execute({
          sql: `INSERT OR REPLACE INTO "_migrations" (name, applied_at) VALUES (?, ?)`,
          args: [m.name, m.applied_at],
        });
      }
      console.log(`  stamped ${sourceMigrations.length} _migrations rows`);
    } finally {
      db.close();
    }
  }

  console.log('\nAll target tenants reset to source-tenant schema parity.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('crashed:', err);
    process.exit(1);
  });
