-- 0009_camp_mob_species.sql
-- Phase A of #28 multi-species refactor (wave/28a).
-- Renumbered from 0005 → 0009 in wave/56 to break a prefix collision with
-- 0005_sars_livestock_election.sql. See 0008_record_legacy_renames.sql.
--
-- Adds a NOT NULL `species` column to Camp + Mob, replaces the global
-- UNIQUE on Camp.campId with a composite UNIQUE(species, campId), and
-- creates a per-table index on species for the cross-cutting UI filters
-- coming in Phase C.
--
-- Backfill: ALTER TABLE ADD COLUMN with a NOT NULL DEFAULT clause sets
-- every existing row's value to the default in libsql/sqlite — verified
-- against `sqlite3` 3.45 + libsql 0.6 in the matching vitest spec
-- (lib/server/__tests__/migration-camp-mob-species.test.ts). No explicit
-- UPDATE statement is needed.
--
-- Idempotency: ADD COLUMN is NOT idempotent on sqlite. The migration
-- runner (lib/migrator.ts) tracks applied filenames in a per-tenant
-- `_migrations` table, so a re-run of the SAME file is skipped at the
-- runner layer. The index half (DROP/CREATE) uses IF EXISTS / IF NOT
-- EXISTS guards so a manual replay of just the index DDL is safe.
--
-- Soak risk: HIGH. The composite-unique replacement requires drop-then-
-- recreate. Per the wave/26 lesson, this PR must soak ≥1h on its
-- per-branch Turso clone before promote.
--
-- Rollback: see migrations/rollback/0009_camp_mob_species.down.sql —
-- operator-only, never auto-applied (the migrator does not recurse into
-- subdirectories).

ALTER TABLE Camp ADD COLUMN species TEXT NOT NULL DEFAULT 'cattle';
ALTER TABLE Mob  ADD COLUMN species TEXT NOT NULL DEFAULT 'cattle';

DROP INDEX IF EXISTS Camp_campId_key;
CREATE UNIQUE INDEX IF NOT EXISTS Camp_species_campId_key ON Camp(species, campId);

CREATE INDEX IF NOT EXISTS Camp_species_idx ON Camp(species);
CREATE INDEX IF NOT EXISTS Mob_species_idx  ON Mob(species);
