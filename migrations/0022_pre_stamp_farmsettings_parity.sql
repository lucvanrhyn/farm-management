-- 0022_pre_stamp_farmsettings_parity.sql
--
-- Pre-stamp half of the FarmSettings schema-parity fix. Mirrors the proven
-- 0016_pre_stamp_animal_species_columns.sql / 0017_animal_species_columns.sql
-- pattern (shipped 2026-05-07, same bug class).
--
-- INCIDENT (2026-05-16). The original single-file 0022_farmsettings_parity.sql
-- (merged via PR #298, issue #280) did a plain `ALTER TABLE "FarmSettings"
-- ADD COLUMN ...` for 21 columns. The premise — "declared in Prisma but
-- created by no migration, therefore absent on tenants" — was only ever
-- verified against a FRESH Turso clone (what the CI gate provisions), where
-- ADD COLUMN always succeeds. On real prod tenants those 21 columns already
-- existed (added historically via the now-forbidden `prisma db push`), so the
-- post-merge promote failed on every tenant with:
--
--   SQLite error: duplicate column name: defaultRestDays
--
-- The atomic batch rolled back, `_migrations` was NOT stamped, and the file
-- re-ran + re-failed on every subsequent promote — jamming the prod promote
-- pipeline AND the governance-gate `audit-schema-parity --fail-on-drift`
-- check repo-wide (the gate's expected-set is read from origin/main, which
-- now lists 0022 that no tenant has applied). See memory:
-- feedback-missing-column-premise-vs-prod-shaped-tenant.md.
--
-- FIX. The DDL is renamed to 0023_farmsettings_parity.sql; this file (sorting
-- before it) marks 0023 as already-applied for any tenant that already has
-- the columns, so the migrator skips the ALTERs entirely. The discriminator
-- is `timezone` (one of the 21) — the cohort got all 21 atomically via a
-- single `prisma db push`, so any one is representative; `timezone` is the
-- column whose absence the #276 regression originally surfaced. Every tenant
-- provisioned from the post-#298 bootstrap DDL (lib/farm-schema.ts, which now
-- declares all 21) also has `timezone`, so it is likewise pre-stamped and the
-- DDL never collides. A genuinely column-less fresh DB (none today, but the
-- safety net) fails the WHERE EXISTS, inserts nothing, and the migrator
-- applies 0023 normally.
--
-- Idempotency: `INSERT OR IGNORE` keys on `_migrations` PRIMARY KEY `name`,
-- so re-running after 0023 is recorded is a no-op. Detection uses sqlite's
-- `pragma_table_info` table-valued function (verified against Turso
-- 2026-05-07 in the 0016 precedent). This file writes only the `_migrations`
-- bookkeeping table — no DDL, no schema change.
--
-- This file MUST sort before 0023; that is why it is `0022_*`.

INSERT OR IGNORE INTO "_migrations" (name, applied_at)
SELECT '0023_farmsettings_parity.sql', CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM pragma_table_info('FarmSettings') WHERE name = 'timezone'
);
