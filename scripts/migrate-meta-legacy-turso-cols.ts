/**
 * Phase E meta-DB migration — adds `legacy_turso_url` + `legacy_turso_auth_token`
 * columns to the `farms` table.
 *
 * Originally added so the (now retired) Phase E per-farm cutover driver
 * could stash a rollback pointer during each per-farm cutover. The
 * cutover script was removed in Wave 1 (2026-04-25) since Phase E is
 * complete; the columns themselves remain in the meta-DB schema and are
 * scheduled to be cleared on the 2026-05-09 soak deadline (see
 * memory/audit-wave-plan-2026-04-25.md). Keeping this column-add script
 * as a historical record and so a fresh meta-DB rebuild stays
 * schema-compatible with backups taken before retirement.
 *
 * Idempotent. Safe to run multiple times.
 *
 * Run:  pnpm tsx scripts/migrate-meta-legacy-turso-cols.ts
 */
import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";

function getClient(): Client {
  const url = process.env.META_TURSO_URL;
  const authToken = process.env.META_TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error("META_TURSO_URL and META_TURSO_AUTH_TOKEN must be set");
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
  if (!(await columnExists(db, "farms", "legacy_turso_url"))) {
    console.log("→ adding farms.legacy_turso_url");
    await db.execute(`ALTER TABLE farms ADD COLUMN legacy_turso_url TEXT`);
  } else {
    console.log("→ farms.legacy_turso_url already present — skipping");
  }

  if (!(await columnExists(db, "farms", "legacy_turso_auth_token"))) {
    console.log("→ adding farms.legacy_turso_auth_token");
    await db.execute(`ALTER TABLE farms ADD COLUMN legacy_turso_auth_token TEXT`);
  } else {
    console.log("→ farms.legacy_turso_auth_token already present — skipping");
  }
}

async function main() {
  const db = getClient();
  await runMigration(db);
  console.log("✓ phase-e meta migration complete");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
