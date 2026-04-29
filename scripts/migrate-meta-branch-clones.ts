/**
 * Meta-DB migration — creates the `branch_db_clones` table and its index.
 *
 * Records one row per git branch for the Option C (issue #19) per-branch
 * Turso DB clone provisioner. Each row tracks the clone's coordinates and
 * promotion timestamps so the CI governance gate (issue #21) can verify
 * preview-soak before allowing prod migration.
 *
 * Idempotent. Running twice is a no-op.
 *
 * Run:  pnpm db:migrate-meta-branch-clones
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

async function tableExists(db: Client, table: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    args: [table],
  });
  return res.rows.length > 0;
}

export async function runMigration(db: Client): Promise<void> {
  if (await tableExists(db, 'branch_db_clones')) {
    console.log('→ branch_db_clones already present — skipping table creation');
  } else {
    console.log('→ creating branch_db_clones table');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS branch_db_clones (
        branch_name        TEXT PRIMARY KEY,
        turso_db_name      TEXT NOT NULL,
        turso_db_url       TEXT NOT NULL,
        turso_auth_token   TEXT NOT NULL,
        source_db_name     TEXT NOT NULL,
        created_at         TEXT NOT NULL,
        last_promoted_at   TEXT,
        prod_migration_at  TEXT
      )
    `);
    console.log('→ creating idx_branch_db_clones_created_at index');
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_branch_db_clones_created_at
        ON branch_db_clones(created_at)
    `);
  }
}

async function main() {
  const db = getClient();
  await runMigration(db);
  console.log('✓ branch-clones meta migration complete');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
