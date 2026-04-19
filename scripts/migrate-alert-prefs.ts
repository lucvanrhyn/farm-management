/**
 * migrate-alert-prefs.ts — Phase J notification engine tenant migration
 *
 * Source-of-truth research: memory/research-phase-j-notifications.md
 *   - §A Inngest architecture (why we need per-tenant durable functions)
 *   - §B de-dup / digest algorithm (why Notification needs dedupKey + payload + collapseKey)
 *   - §C preference UI wireframe (AlertPreference shape)
 *
 * Idempotently applies on every tenant DB:
 *
 *   1. Extend "Notification":
 *        + dedupKey    TEXT             (nullable; unique with type when non-null)
 *        + payload     TEXT             (JSON string; matches project convention — libSQL has no JSON type)
 *        + collapseKey TEXT
 *        + updatedAt   DATETIME         DEFAULT CURRENT_TIMESTAMP
 *      plus indices:
 *        * idx_notification_collapse       (collapseKey)
 *        * idx_notification_dedup          (type, dedupKey) PARTIAL UNIQUE WHERE dedupKey IS NOT NULL
 *
 *   2. Create "AlertPreference" table (user × category × channel × species-scope).
 *
 *   3. Extend "FarmSettings":
 *        + quietHoursStart        TEXT DEFAULT '20:00'
 *        + quietHoursEnd          TEXT DEFAULT '06:00'
 *        + timezone               TEXT DEFAULT 'Africa/Johannesburg'
 *        + speciesAlertThresholds TEXT  (nullable JSON string)
 *
 * Idempotent: PRAGMA table_info gate before every ADD COLUMN (SQLite has no
 * IF NOT EXISTS on ALTER). Tables use CREATE TABLE IF NOT EXISTS, indices use
 * CREATE INDEX IF NOT EXISTS. Safe to re-run any number of times.
 *
 * One deliberate divergence from the silent-skip pattern in the other migration
 * scripts: this one EXITS NONZERO if any tenant failed, so CI/Luc notices. This
 * is an infrastructure migration — partial application would leave Inngest
 * functions writing to tables that don't exist on some tenants.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-alert-prefs.ts
 */

import { createClient, type Client } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';

// ── DDL fragments ──────────────────────────────────────────────────────────

const ADD_NOTIFICATION_COLUMNS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: 'dedupKey',    sql: `ALTER TABLE "Notification" ADD COLUMN "dedupKey" TEXT` },
  { name: 'payload',     sql: `ALTER TABLE "Notification" ADD COLUMN "payload" TEXT` },
  { name: 'collapseKey', sql: `ALTER TABLE "Notification" ADD COLUMN "collapseKey" TEXT` },
  // NOTE: libSQL/SQLite forbids non-constant defaults on ADD COLUMN, so we can't use
  // CURRENT_TIMESTAMP here. Backfill below sets existing rows; new inserts are handled
  // by Prisma's @updatedAt / app code.
  { name: 'updatedAt',          sql: `ALTER TABLE "Notification" ADD COLUMN "updatedAt" DATETIME` },
  // Dispatch idempotency flags (at-most-once under Inngest retry). Set BEFORE the
  // actual network send so a mid-flight failure still blocks the retry from firing
  // a duplicate — prefer missed-push over double-push per research brief §B.
  { name: 'pushDispatchedAt',   sql: `ALTER TABLE "Notification" ADD COLUMN "pushDispatchedAt" DATETIME` },
  { name: 'digestDispatchedAt', sql: `ALTER TABLE "Notification" ADD COLUMN "digestDispatchedAt" DATETIME` },
];

const ADD_FARM_SETTINGS_COLUMNS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: 'quietHoursStart',        sql: `ALTER TABLE "FarmSettings" ADD COLUMN "quietHoursStart" TEXT DEFAULT '20:00'` },
  { name: 'quietHoursEnd',          sql: `ALTER TABLE "FarmSettings" ADD COLUMN "quietHoursEnd" TEXT DEFAULT '06:00'` },
  { name: 'timezone',               sql: `ALTER TABLE "FarmSettings" ADD COLUMN "timezone" TEXT DEFAULT 'Africa/Johannesburg'` },
  { name: 'speciesAlertThresholds', sql: `ALTER TABLE "FarmSettings" ADD COLUMN "speciesAlertThresholds" TEXT` },
];

const CREATE_ALERT_PREFERENCE_TABLE = `
CREATE TABLE IF NOT EXISTS "AlertPreference" (
  "id"              TEXT PRIMARY KEY,
  "userId"          TEXT NOT NULL,
  "category"        TEXT NOT NULL,
  "alertType"       TEXT,
  "channel"         TEXT NOT NULL,
  "enabled"         INTEGER NOT NULL DEFAULT 1,
  "digestMode"      TEXT NOT NULL DEFAULT 'realtime',
  "speciesOverride" TEXT,
  "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlertPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
`;

// Composite unique with nullable columns: SQLite treats every NULL as distinct,
// which matches Prisma's intent (@@unique with optional fields de-dups on
// non-null combinations only). No special handling needed.
const ALERT_PREFERENCE_INDICES: ReadonlyArray<string> = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "AlertPreference_unique_user_pref_idx"
     ON "AlertPreference"("userId", "category", "alertType", "channel", "speciesOverride")`,
  `CREATE INDEX IF NOT EXISTS "AlertPreference_userId_idx"
     ON "AlertPreference"("userId")`,
];

// Partial unique index — (type, dedupKey) must be unique ONLY when dedupKey is
// non-null. libSQL supports WHERE clauses on CREATE INDEX (SQLite 3.8+).
const NOTIFICATION_INDICES: ReadonlyArray<string> = [
  `CREATE INDEX IF NOT EXISTS "notification_collapse_idx"
     ON "Notification"("collapseKey")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "notification_dedup_idx"
     ON "Notification"("type", "dedupKey") WHERE "dedupKey" IS NOT NULL`,
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function columnExists(db: Client, table: string, name: string): Promise<boolean> {
  const info = await db.execute(`PRAGMA table_info("${table}")`);
  return info.rows.some((row) => row.name === name);
}

async function tableExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  return res.rows.length > 0;
}

async function addColumnsIfMissing(
  db: Client,
  table: string,
  columns: ReadonlyArray<{ name: string; sql: string }>,
  addedLog: string[],
): Promise<void> {
  for (const col of columns) {
    const exists = await columnExists(db, table, col.name);
    if (!exists) {
      await db.execute(col.sql);
      addedLog.push(`${table}.${col.name}`);
    }
  }
}

async function backfillNotificationUpdatedAt(db: Client): Promise<number> {
  // After ADD COLUMN updatedAt (NULL default, per libSQL constraint), backfill
  // existing rows to createdAt so the column is immediately usable. Gated on
  // IS NULL so re-runs are no-ops.
  const res = await db.execute(`
    UPDATE "Notification"
       SET "updatedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
     WHERE "updatedAt" IS NULL
  `);
  return Number(res.rowsAffected ?? 0);
}

// ── Per-tenant migration ───────────────────────────────────────────────────

async function migrateOne(slug: string): Promise<void> {
  const creds = await getFarmCreds(slug);
  if (!creds) {
    console.warn(`  [${slug}] no creds, skipping`);
    return;
  }

  const db = createClient({
    url: creds.tursoUrl,
    authToken: creds.tursoAuthToken,
  });

  const added: string[] = [];
  let createdAlertPref = false;
  let backfilled = 0;

  try {
    // Guard: Notification table must already exist (created by base schema push).
    const hasNotif = await tableExists(db, 'Notification');
    if (!hasNotif) {
      throw new Error(
        `Notification table missing on tenant "${slug}" — run base schema push before this migration.`,
      );
    }

    // 1. Notification extensions
    await addColumnsIfMissing(db, 'Notification', ADD_NOTIFICATION_COLUMNS, added);
    backfilled = await backfillNotificationUpdatedAt(db);
    for (const sql of NOTIFICATION_INDICES) {
      await db.execute(sql);
    }

    // 2. AlertPreference table
    const hadAlertPref = await tableExists(db, 'AlertPreference');
    await db.execute(CREATE_ALERT_PREFERENCE_TABLE);
    createdAlertPref = !hadAlertPref;
    for (const sql of ALERT_PREFERENCE_INDICES) {
      await db.execute(sql);
    }

    // 3. FarmSettings extensions
    const hasFarmSettings = await tableExists(db, 'FarmSettings');
    if (!hasFarmSettings) {
      throw new Error(
        `FarmSettings table missing on tenant "${slug}" — run base schema push before this migration.`,
      );
    }
    await addColumnsIfMissing(db, 'FarmSettings', ADD_FARM_SETTINGS_COLUMNS, added);

    const parts = [
      added.length > 0 ? `added ${added.join(', ')}` : 'no column changes',
      createdAlertPref ? 'AlertPreference created' : 'AlertPreference exists',
      backfilled > 0 ? `backfilled ${backfilled} Notification.updatedAt` : 'no backfill needed',
    ];
    console.log(`  [${slug}] ok — ${parts.join('; ')}`);
  } finally {
    db.close();
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n-- Phase J notification migration (AlertPreference + Notification.dedupKey + FarmSettings quiet hours) --\n');

  const slugs = await getAllFarmSlugs();
  if (slugs.length === 0) {
    console.log('No farms found. Nothing to do.');
    return;
  }

  console.log(`Found ${slugs.length} farm(s): ${slugs.join(', ')}\n`);

  let ok = 0;
  let failed = 0;
  for (const slug of slugs) {
    try {
      await migrateOne(slug);
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`  [${slug}] FAILED:`, err);
    }
  }

  console.log(`\nDone. ${ok} succeeded, ${failed} failed.`);
  // Divergence from the silent-skip pattern in other scripts: any failure is
  // fatal here because Inngest functions will depend on these tables existing
  // on every tenant. Partial application is worse than none.
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
