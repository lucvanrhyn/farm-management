-- 0018_it3_snapshot.sql
--
-- Canonical migration for the It3Snapshot table. Replaces the historical
-- hand-rolled scripts/migrate-it3-snapshot.ts (deleted in this wave per
-- feedback-no-hand-rolled-migrate-scripts.md — that script ran outside the
-- canonical migrator and could leave new tenants without the table).
--
-- This migration is idempotent — `CREATE TABLE IF NOT EXISTS` lets
-- already-stamped tenants no-op while new tenants get the schema. The
-- `verifyMigrationApplied` probe (lib/migrator.ts, PRD #128 #141) parses the
-- CREATE TABLE statement and probes sqlite_master + pragma_table_info; if
-- Turso silently fails to apply, the bookkeeping row is rolled back so the
-- file re-runs on the next batch.
--
-- Discipline notes:
--   * No DEFAULT CURRENT_TIMESTAMP — Prisma populates `issuedAt` via @default(now()).
--   * Quoted identifiers throughout (keyword-table guard per
--     feedback-quote-sql-keywords-in-migrations.md).
--   * `It3Snapshot` matches prisma/schema.prisma `model It3Snapshot` 1:1.

CREATE TABLE IF NOT EXISTS "It3Snapshot" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "taxYear"     INTEGER  NOT NULL,
    "issuedAt"    DATETIME NOT NULL,
    "periodStart" TEXT     NOT NULL,
    "periodEnd"   TEXT     NOT NULL,
    "payload"     TEXT     NOT NULL,
    "generatedBy" TEXT,
    "pdfHash"     TEXT,
    "voidedAt"    DATETIME,
    "voidReason"  TEXT
);

CREATE INDEX IF NOT EXISTS "idx_it3_tax_year"
ON "It3Snapshot" ("taxYear");

CREATE INDEX IF NOT EXISTS "idx_it3_issued_at"
ON "It3Snapshot" ("issuedAt");
