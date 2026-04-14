/**
 * Idempotent migration: adds billing columns to farms table and creates
 * consulting_leads + consulting_engagements tables for Workstream A/D.
 *
 * Safe to run multiple times — column-existence check via pragma_table_info,
 * CREATE TABLE IF NOT EXISTS for new tables.
 *
 * Run:  pnpm run db:migrate:meta
 */
import type { Client } from '@libsql/client';
import { createClient } from '@libsql/client';

function getClient(): Client {
  const url = process.env.META_TURSO_URL;
  const authToken = process.env.META_TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error('META_TURSO_URL and META_TURSO_AUTH_TOKEN must be set');
  }
  return createClient({ url, authToken });
}

/** Check if a column exists on a SQLite/LibSQL table via pragma_table_info. */
export async function columnExists(
  db: Client,
  table: string,
  column: string,
): Promise<boolean> {
  const result = await db.execute({
    sql: `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  });
  return result.rows.length > 0;
}

/** Add a column only if it doesn't already exist. Returns true if added. */
export async function addColumnIfMissing(
  db: Client,
  table: string,
  column: string,
  type: string,
): Promise<boolean> {
  // Guard against DDL injection — table/column/type are interpolated directly
  // since LibSQL does not support parameter binding in DDL statements.
  // Only word characters (letters, digits, underscore) are allowed.
  const WORD = /^\w+$/;
  if (!WORD.test(table) || !WORD.test(column)) {
    throw new Error(`addColumnIfMissing: invalid identifier — table=${table}, column=${column}`);
  }
  if (!WORD.test(type.split(' ')[0])) {
    throw new Error(`addColumnIfMissing: invalid type — ${type}`);
  }

  if (await columnExists(db, table, column)) return false;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  return true;
}

export async function runMigration(db: Client): Promise<void> {
  console.log('→ farms billing columns');
  const cols: Array<[string, string]> = [
    ['billing_frequency', 'TEXT'],
    ['locked_lsu', 'INTEGER'],
    ['billing_amount_zar', 'INTEGER'],
    ['next_renewal_at', 'TEXT'],
  ];
  for (const [name, type] of cols) {
    const added = await addColumnIfMissing(db, 'farms', name, type);
    console.log(`  ${added ? '+' : '·'} farms.${name}`);
  }

  console.log('→ consulting_leads table');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS consulting_leads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      farm_name TEXT NOT NULL,
      province TEXT,
      species_json TEXT,
      herd_size INTEGER,
      data_notes TEXT,
      custom_tracking TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      assigned_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_consulting_leads_status
      ON consulting_leads(status)
  `);

  console.log('→ consulting_engagements table');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS consulting_engagements (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      farm_id TEXT,
      setup_fee_zar INTEGER NOT NULL,
      retainer_fee_zar INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ends_at TEXT,
      status TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES consulting_leads(id)
    )
  `);

  console.log('✓ meta-db pricing migration complete');
}

async function main(): Promise<void> {
  const db = getClient();
  await runMigration(db);
}

// Only run when invoked directly (allow import without execution for tests)
if (require.main === module) {
  main().catch((err) => {
    console.error('✗ migration failed:', err);
    process.exit(1);
  });
}
