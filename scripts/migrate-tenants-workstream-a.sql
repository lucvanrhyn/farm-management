-- Workstream A tenant migration
-- Apply:  turso db shell basson-boerdery < scripts/migrate-tenants-workstream-a.sql
--         turso db shell trio-b-boerdery < scripts/migrate-tenants-workstream-a.sql
-- (replace with actual slugs from meta DB)
--
-- Idempotent: uses CREATE TABLE IF NOT EXISTS.
-- ALTER TABLE column additions will error if re-run on an already-migrated DB;
-- run only once per tenant or check pragma_table_info first.

-- 1. Animal pedigree notes + import traceability
ALTER TABLE Animal ADD COLUMN sireNote TEXT;
ALTER TABLE Animal ADD COLUMN damNote TEXT;
ALTER TABLE Animal ADD COLUMN importJobId TEXT;

-- 2. ImportJob table (AI wizard import provenance)
CREATE TABLE IF NOT EXISTS ImportJob (
  id             TEXT PRIMARY KEY,
  farmId         TEXT NOT NULL,
  sourceFileHash TEXT NOT NULL,
  sourceFilename TEXT NOT NULL,
  mappingJson    TEXT NOT NULL,
  rowsImported   INTEGER NOT NULL DEFAULT 0,
  rowsFailed     INTEGER NOT NULL DEFAULT 0,
  warnings       TEXT,
  inputTokens    INTEGER,
  outputTokens   INTEGER,
  cachedTokens   INTEGER,
  costZar        REAL,
  createdAt      TEXT NOT NULL DEFAULT (datetime('now')),
  confirmedBy    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_import_job_farm_created
  ON ImportJob(farmId, createdAt);

-- 3. CustomField table (Consulting tier custom schema)
CREATE TABLE IF NOT EXISTS CustomField (
  id        TEXT PRIMARY KEY,
  farmId    TEXT NOT NULL,
  name      TEXT NOT NULL,
  appliesTo TEXT NOT NULL,
  dataType  TEXT NOT NULL,
  source    TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(farmId, appliesTo, name)
);

-- 4. FK from Animal to ImportJob (applied after both tables exist)
-- Note: SQLite does not enforce FKs by default and does not support
-- adding FKs via ALTER TABLE. The FK is declared in schema.prisma for
-- Prisma's type system only. SetNull-on-delete is handled in application
-- code when deleting an ImportJob.
