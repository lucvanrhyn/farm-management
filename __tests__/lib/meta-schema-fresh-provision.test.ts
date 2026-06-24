/**
 * @vitest-environment node
 *
 * Fresh meta-DB provisioning guard (DR / #105-class parity).
 *
 * Proves the two-step provisioning of a brand-new meta DB works end to end:
 *   1. scripts/seed-meta-db.ts createTables() → lib/meta-schema.ts META_BASE_DDL
 *   2. scripts/migrate.ts → lib/meta-migrator.ts applies meta-migrations/*.sql
 *
 * Regression target: META_BASE_DDL historically omitted branch_db_clones,
 * vitals_events, consulting_* and the farms subscription/billing/legacy columns
 * (they only existed via hand-rolled migrate-meta-*.ts scripts), so on a fresh
 * meta DB migration 0001 (`ALTER TABLE branch_db_clones ADD COLUMN head_sha`)
 * failed with "no such table" — the DB was un-provisionable. This test runs the
 * real base DDL + the real numbered migrations against an in-memory libSQL DB
 * and asserts the whole sequence applies cleanly.
 */
import { describe, it, expect } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { join } from "node:path";
import { META_BASE_DDL, createMetaTables } from "@/lib/meta-schema";
import { loadMetaMigrations, runMetaMigrations } from "@/lib/meta-migrator";

const META_MIGRATIONS_DIR = join(process.cwd(), "meta-migrations");

async function tableExists(db: Client, table: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    args: [table],
  });
  return res.rows.length > 0;
}

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  });
  return res.rows.length > 0;
}

function freshDb(): Client {
  return createClient({ url: ":memory:" });
}

describe("fresh meta-DB provisioning — base DDL + numbered migrations", () => {
  it("applies every numbered migration on top of the base schema with zero errors", async () => {
    const db = freshDb();
    try {
      await createMetaTables(db);
      const migrations = await loadMetaMigrations(META_MIGRATIONS_DIR);
      expect(migrations.length).toBeGreaterThan(0);

      // The whole point: this must not throw (it threw "no such table:
      // branch_db_clones" before the parity gap was closed).
      const result = await runMetaMigrations(db, migrations);

      // Fresh DB → all applied, none skipped.
      expect(result.applied).toEqual(migrations.map((m) => m.name));
      expect(result.skipped).toEqual([]);

      const tracked = await db.execute(`SELECT name FROM "_meta_migrations"`);
      expect(tracked.rows.length).toBe(migrations.length);
    } finally {
      db.close();
    }
  });

  it("is idempotent — a second migration run skips everything", async () => {
    const db = freshDb();
    try {
      await createMetaTables(db);
      const migrations = await loadMetaMigrations(META_MIGRATIONS_DIR);
      await runMetaMigrations(db, migrations);
      const second = await runMetaMigrations(db, migrations);
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(migrations.map((m) => m.name));
    } finally {
      db.close();
    }
  });

  it("base schema carries the tables + farms columns the app reads that no migration adds (parity guard)", async () => {
    const db = freshDb();
    try {
      await createMetaTables(db);

      for (const t of [
        "users",
        "farms",
        "farm_users",
        "RateLimit",
        "branch_db_clones",
        "vitals_events",
        "consulting_leads",
        "consulting_engagements",
      ]) {
        expect(await tableExists(db, t), `table ${t} must be in the base schema`).toBe(true);
      }

      // farms subscription/billing/legacy columns SELECTed by lib/meta-db.ts.
      for (const c of [
        "subscription_status",
        "subscription_started_at",
        "payfast_token",
        "billing_frequency",
        "locked_lsu",
        "billing_amount_zar",
        "next_renewal_at",
        "legacy_turso_url",
        "legacy_turso_auth_token",
      ]) {
        expect(await columnExists(db, "farms", c), `farms.${c} must be in the base schema`).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it("base schema OMITS columns added by bare ALTER migrations (0001/0002/0004), which then add them", async () => {
    const db = freshDb();
    try {
      await createMetaTables(db);

      // Must be absent in the base, or the bare ALTER migrations would
      // dup-column-error on a fresh DB.
      expect(await columnExists(db, "branch_db_clones", "head_sha")).toBe(false);
      expect(await columnExists(db, "branch_db_clones", "last_smoke_status")).toBe(false);
      expect(await columnExists(db, "users", "password_reset_token")).toBe(false);

      await runMetaMigrations(db, await loadMetaMigrations(META_MIGRATIONS_DIR));

      // Present after migrations run.
      expect(await columnExists(db, "branch_db_clones", "head_sha")).toBe(true);
      expect(await columnExists(db, "branch_db_clones", "soak_started_at")).toBe(true);
      expect(await columnExists(db, "branch_db_clones", "last_smoke_status")).toBe(true);
      expect(await columnExists(db, "branch_db_clones", "last_smoke_at")).toBe(true);
      expect(await columnExists(db, "users", "password_reset_token")).toBe(true);
      expect(await columnExists(db, "users", "password_reset_expires")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("META_BASE_DDL is fully idempotent (re-applying against an existing DB is a no-op)", async () => {
    const db = freshDb();
    try {
      await createMetaTables(db);
      // Second application must not throw (all CREATE ... IF NOT EXISTS).
      await expect(db.executeMultiple(META_BASE_DDL)).resolves.not.toThrow();
    } finally {
      db.close();
    }
  });
});
