/**
 * migrate-phase-k-tasks.ts — Phase K tenant migration (Tasks + Geo-Map)
 *
 * Idempotently applies to every tenant:
 *
 *   1. Extend "Task" with 10 additive nullable columns for spatial + recurrence:
 *        taskType, lat, lng, recurrenceRule, reminderOffset, assigneeIds,
 *        templateId, blockedByIds, completedObservationId, recurrenceSource.
 *      Adds idx_task_type + idx_task_template.
 *
 *   2. Create "TaskTemplate" (+ indices) — static seed bank installs land here.
 *
 *   3. Create "TaskOccurrence" (+ indices) — materialised occurrences driven by
 *      the Inngest regenerate cron (lib/server/inngest/tasks.ts).
 *
 *   4. Extend "GameRainfallRecord" (Prisma: RainfallRecord, @@map target) with
 *      nullable lat/lng for the map rainfall-gauge layer.
 *
 *   5. Extend "FarmSettings" with taskSettings + mapSettings (nullable JSON
 *      blobs for /admin/settings/{tasks,map} persistence — added by Wave 3F).
 *
 * Guardrails (Phase J / Phase B lessons):
 *   - PRAGMA table_info gate before every ALTER ADD COLUMN (SQLite has no
 *     IF NOT EXISTS on ALTER).
 *   - CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS throughout.
 *   - Additive only — no renames, no drops, no destructive changes.
 *   - No module-load-time env reads — everything inside async main().
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-phase-k-tasks.ts
 *
 * Fatal on any tenant failure (mirrors migrate-alert-prefs.ts): Inngest cron
 * and /api/tasks* now depend on these columns/tables on every tenant.
 */

import { createClient, type Client } from "@libsql/client";
import { getAllFarmSlugs, getFarmCreds } from "../lib/meta-db";

// ── Task additive columns ─────────────────────────────────────────────────

const ADD_TASK_COLUMNS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: "taskType",               sql: `ALTER TABLE "Task" ADD COLUMN "taskType" TEXT` },
  { name: "lat",                    sql: `ALTER TABLE "Task" ADD COLUMN "lat" REAL` },
  { name: "lng",                    sql: `ALTER TABLE "Task" ADD COLUMN "lng" REAL` },
  { name: "recurrenceRule",         sql: `ALTER TABLE "Task" ADD COLUMN "recurrenceRule" TEXT` },
  { name: "reminderOffset",         sql: `ALTER TABLE "Task" ADD COLUMN "reminderOffset" INTEGER` },
  { name: "assigneeIds",            sql: `ALTER TABLE "Task" ADD COLUMN "assigneeIds" TEXT` },
  { name: "templateId",             sql: `ALTER TABLE "Task" ADD COLUMN "templateId" TEXT` },
  { name: "blockedByIds",           sql: `ALTER TABLE "Task" ADD COLUMN "blockedByIds" TEXT` },
  { name: "completedObservationId", sql: `ALTER TABLE "Task" ADD COLUMN "completedObservationId" TEXT` },
  { name: "recurrenceSource",       sql: `ALTER TABLE "Task" ADD COLUMN "recurrenceSource" TEXT` },
];

const TASK_INDICES: ReadonlyArray<string> = [
  `CREATE INDEX IF NOT EXISTS "idx_task_type"     ON "Task"("taskType")`,
  `CREATE INDEX IF NOT EXISTS "idx_task_template" ON "Task"("templateId")`,
];

// ── TaskTemplate table ────────────────────────────────────────────────────

const CREATE_TASK_TEMPLATE_TABLE = `
CREATE TABLE IF NOT EXISTS "TaskTemplate" (
  "id"              TEXT PRIMARY KEY,
  "tenantSlug"      TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "name_af"         TEXT,
  "taskType"        TEXT NOT NULL,
  "description"     TEXT,
  "description_af"  TEXT,
  "priorityDefault" TEXT,
  "recurrenceRule"  TEXT,
  "reminderOffset"  INTEGER,
  "species"         TEXT,
  "isPublic"        INTEGER NOT NULL DEFAULT 1,
  "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const TASK_TEMPLATE_INDICES: ReadonlyArray<string> = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "TaskTemplate_tenantSlug_name_key"
     ON "TaskTemplate"("tenantSlug", "name")`,
  `CREATE INDEX IF NOT EXISTS "idx_task_template_tenant_type"
     ON "TaskTemplate"("tenantSlug", "taskType")`,
];

// ── TaskOccurrence table ──────────────────────────────────────────────────

const CREATE_TASK_OCCURRENCE_TABLE = `
CREATE TABLE IF NOT EXISTS "TaskOccurrence" (
  "id"                   TEXT PRIMARY KEY,
  "taskId"               TEXT NOT NULL,
  "occurrenceAt"         DATETIME NOT NULL,
  "reminderAt"           DATETIME,
  "status"               TEXT NOT NULL DEFAULT 'pending',
  "completedAt"          DATETIME,
  "reminderDispatchedAt" DATETIME,
  "createdAt"            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskOccurrence_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE
);
`;

const TASK_OCCURRENCE_INDICES: ReadonlyArray<string> = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "TaskOccurrence_taskId_occurrenceAt_key"
     ON "TaskOccurrence"("taskId", "occurrenceAt")`,
  `CREATE INDEX IF NOT EXISTS "idx_task_occurrence_reminder"
     ON "TaskOccurrence"("reminderAt", "reminderDispatchedAt")`,
  `CREATE INDEX IF NOT EXISTS "idx_task_occurrence_at_status"
     ON "TaskOccurrence"("occurrenceAt", "status")`,
];

// ── RainfallRecord extensions (SQLite table is GameRainfallRecord via @@map) ──

const ADD_RAINFALL_COLUMNS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: "lat", sql: `ALTER TABLE "GameRainfallRecord" ADD COLUMN "lat" REAL` },
  { name: "lng", sql: `ALTER TABLE "GameRainfallRecord" ADD COLUMN "lng" REAL` },
];

// ── FarmSettings extensions (Wave 3F) ─────────────────────────────────────

const ADD_FARM_SETTINGS_COLUMNS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: "taskSettings", sql: `ALTER TABLE "FarmSettings" ADD COLUMN "taskSettings" TEXT` },
  { name: "mapSettings",  sql: `ALTER TABLE "FarmSettings" ADD COLUMN "mapSettings" TEXT` },
];

// ── Helpers ───────────────────────────────────────────────────────────────

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

// ── Per-tenant migration ───────────────────────────────────────────────────

async function migrateOne(slug: string): Promise<void> {
  const creds = await getFarmCreds(slug);
  if (!creds) {
    console.warn(`  [${slug}] no creds, skipping`);
    return;
  }

  const db = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
  const added: string[] = [];
  let createdTaskTemplate = false;
  let createdTaskOccurrence = false;

  try {
    // Precondition: Task + FarmSettings + GameRainfallRecord must exist from base schema.
    for (const requiredTable of ["Task", "FarmSettings", "GameRainfallRecord"]) {
      if (!(await tableExists(db, requiredTable))) {
        throw new Error(
          `${requiredTable} table missing on tenant "${slug}" — run base schema push before Phase K migration.`,
        );
      }
    }

    // 1. Task columns + indices
    await addColumnsIfMissing(db, "Task", ADD_TASK_COLUMNS, added);
    for (const sql of TASK_INDICES) {
      await db.execute(sql);
    }

    // 2. TaskTemplate
    const hadTt = await tableExists(db, "TaskTemplate");
    await db.execute(CREATE_TASK_TEMPLATE_TABLE);
    createdTaskTemplate = !hadTt;
    for (const sql of TASK_TEMPLATE_INDICES) {
      await db.execute(sql);
    }

    // 3. TaskOccurrence
    const hadTo = await tableExists(db, "TaskOccurrence");
    await db.execute(CREATE_TASK_OCCURRENCE_TABLE);
    createdTaskOccurrence = !hadTo;
    for (const sql of TASK_OCCURRENCE_INDICES) {
      await db.execute(sql);
    }

    // 4. GameRainfallRecord coords
    await addColumnsIfMissing(db, "GameRainfallRecord", ADD_RAINFALL_COLUMNS, added);

    // 5. FarmSettings (Wave 3F)
    await addColumnsIfMissing(db, "FarmSettings", ADD_FARM_SETTINGS_COLUMNS, added);

    const parts = [
      added.length > 0 ? `added ${added.join(", ")}` : "no column changes",
      createdTaskTemplate ? "TaskTemplate created" : "TaskTemplate exists",
      createdTaskOccurrence ? "TaskOccurrence created" : "TaskOccurrence exists",
    ];
    console.log(`  [${slug}] ok — ${parts.join("; ")}`);
  } finally {
    db.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n-- Phase K tenant migration (Tasks + Geo-Map) --\n");

  const slugs = await getAllFarmSlugs();
  if (slugs.length === 0) {
    console.log("No farms found. Nothing to do.");
    return;
  }

  console.log(`Found ${slugs.length} farm(s): ${slugs.join(", ")}\n`);

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
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
