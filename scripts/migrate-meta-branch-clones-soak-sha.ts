/**
 * Meta-DB migration — adds `head_sha` and `soak_started_at` columns to the
 * `branch_db_clones` table.
 *
 * Issue #101 fix: the soak gate was keying on `created_at` (branch clone
 * creation time), allowing a force-push or re-push to a long-lived branch to
 * bypass the soak requirement. These two columns store the commit SHA that last
 * passed CI and the timestamp when that CI run completed, so the gate can
 * verify that the SPECIFIC commit being promoted has soaked, not just the
 * branch clone.
 *
 * Column semantics:
 *   head_sha        — full or short commit SHA stamped by `recordCiPassForCommit`
 *                     when CI finishes for a given branch + commit combination.
 *   soak_started_at — ISO timestamp of when CI passed for `head_sha`.
 *                     `promoteToProd` measures elapsed time from this column,
 *                     not from `created_at`, when a `headSha` is provided.
 *
 * Both columns are nullable for backward compatibility with existing rows that
 * pre-date this migration. When null, `promoteToProd` falls back to the legacy
 * `created_at`-based gate.
 *
 * Idempotent. Safe to run multiple times.
 *
 * Run:  pnpm db:migrate:meta:branch-clones-soak-sha
 */
import type { Client } from '@libsql/client';
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';

function getClient(): Client {
  const url = process.env.META_TURSO_URL;
  const authToken = process.env.META_TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error('META_TURSO_URL and META_TURSO_AUTH_TOKEN must be set');
  }
  return createClient({ url, authToken });
}

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  });
  return res.rows.length > 0;
}

export async function runMigration(db: Client): Promise<void> {
  if (!(await columnExists(db, 'branch_db_clones', 'head_sha'))) {
    console.log('→ adding branch_db_clones.head_sha');
    await db.execute(`ALTER TABLE branch_db_clones ADD COLUMN head_sha TEXT`);
  } else {
    console.log('→ branch_db_clones.head_sha already present — skipping');
  }

  if (!(await columnExists(db, 'branch_db_clones', 'soak_started_at'))) {
    console.log('→ adding branch_db_clones.soak_started_at');
    await db.execute(`ALTER TABLE branch_db_clones ADD COLUMN soak_started_at TEXT`);
  } else {
    console.log('→ branch_db_clones.soak_started_at already present — skipping');
  }
}

async function main() {
  const db = getClient();
  await runMigration(db);
  console.log('✓ branch-clones soak-sha meta migration complete');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
