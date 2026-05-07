-- 0016_pre_stamp_animal_species_columns.sql
--
-- Pre-stamp half of wave/130 schema-drift fix.
--
-- Background. Multi-species support (issue #28, 2026-04-27) added two
-- columns to the Animal table:
--
--   species      String  @default("cattle")
--   speciesData  String?
--
-- Pre-rule-tightening tenants got those columns through legacy
-- `prisma db push` and never received a migration file. After CLAUDE.md
-- banned hand-rolled migrations / `prisma db push` (2026-04-28),
-- `acme-cattle` was provisioned as a fresh clone and never got the
-- columns — every Prisma query that projects `species` (notably
-- `prisma.animal.groupBy({by: ["species"]})` in the dashboard helper)
-- crashed with HTTP 500.
--
-- This file is the bookkeeping half. The actual DDL lives in the next
-- migration, 0017_animal_species_columns.sql. For tenants that already
-- have the columns (the pre-rule-tightening cohort) we mark 0017 as
-- applied here so the migrator skips it. For basson (and any future
-- fresh clone provisioned without these columns) the WHERE EXISTS
-- predicate is false, this file inserts nothing, and the migrator
-- applies 0017 normally.
--
-- Detection uses sqlite's `pragma_table_info` table-valued function,
-- verified against Turso 2026-05-07.
--
-- Idempotency. `INSERT OR IGNORE` keys on PRIMARY KEY `name`, so re-running
-- this file is a no-op even after 0017 has been recorded.
--
-- This file MUST sort before 0017; that's why it is `0016_*`.

INSERT OR IGNORE INTO "_migrations" (name, applied_at)
SELECT '0017_animal_species_columns.sql', CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM pragma_table_info('Animal') WHERE name = 'species'
);
