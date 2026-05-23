-- 0021_death_carcass_disposal.sql
--
-- Wave 3b / #254 (PRD #250) — Death single-cause + required carcassDisposal.
--
-- Adds the `carcassDisposal` column to the `Observation` table. Death
-- events are persisted as `Observation` rows with `type = 'death'`; a
-- dedicated column (vs. JSON-in-details) lets future SARS / NSPCA reporting
-- queries filter on disposal without parsing the JSON details blob and
-- lets the `audit-findmany-no-select` gate enforce the column is fetched
-- explicitly when a query needs it.
--
-- Enum values (HITL-locked, see CARCASS_DISPOSAL_VALUES in
-- `lib/server/validators/death.ts`):
--   BURIED, BURNED, RENDERED, OTHER
--
-- Backfill semantics:
--   Every existing `Observation` row with `type = 'death'` is backfilled
--   with `carcassDisposal = 'OTHER'`. This is the regulatory-safe initial
--   choice — operators can edit individual rows after the fact via the
--   admin observations table. Non-death rows get NULL (the column is
--   nullable at the DB level for non-death rows because the
--   disposal-required invariant is enforced at the application layer
--   inside the Death validator).
--
-- Discipline notes (mirrors migration 0019_observation_idempotency.sql):
--   * Identifier quoting per feedback-quote-sql-keywords-in-migrations.md.
--   * The column is NULLABLE at the SQL level — SQLite's
--     `ALTER TABLE ADD COLUMN NOT NULL` requires a server-side default,
--     and we don't want to pin a default at the DB layer (it would mask
--     the application-layer validator's DEATH_DISPOSAL_REQUIRED rejection
--     on a fresh death row that bypasses the validator). The
--     application-layer guarantee is: every `type='death'` row written
--     through `POST /api/observations` has a non-null disposal because
--     the validator rejects empty/invalid disposals before the row hits
--     Prisma.
--   * The `verifyMigrationApplied` probe (PRD #128 #141) parses the
--     ALTER TABLE statement and probes pragma_table_info; if Turso silently
--     fails to apply, the bookkeeping row is rolled back so the file
--     re-runs on the next batch.
--   * The `checkPrismaColumnParity` gate (PRD #128 #137) verifies that
--     the live DB column matches the Prisma schema declaration in the
--     same commit (`prisma/schema.prisma` — `Observation.carcassDisposal`).
--   * Per-tenant Turso DB architecture means there is no shared
--     `Observation` table — the migration runs against each tenant clone
--     via `lib/migrator.ts` + `_migrations` bookkeeping (atomic per file).
--   * NO hand-rolled `scripts/migrate-*` script (per
--     feedback-no-hand-rolled-migrate-scripts.md). All Death-disposal
--     schema changes go through this single migration file.

ALTER TABLE "Observation" ADD COLUMN "carcassDisposal" TEXT;

-- Backfill: every existing death row gets the regulatory-safe initial
-- disposal value. Future tenants where the table is empty are a no-op.
-- The `WHERE` clause guards against re-runs accidentally clobbering an
-- operator-edited disposal value (the application UPDATE path would have
-- already set a non-NULL value; we only fill NULLs).
UPDATE "Observation"
   SET "carcassDisposal" = 'OTHER'
 WHERE "type" = 'death'
   AND "carcassDisposal" IS NULL;
