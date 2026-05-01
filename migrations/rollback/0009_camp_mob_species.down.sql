-- 0009_camp_mob_species.down.sql
-- OPERATOR-ONLY ROLLBACK for migration 0009_camp_mob_species.sql.
-- (Renumbered from 0005 → 0009 in wave/56 — see 0008_record_legacy_renames.sql.
--  Older tenant `_migrations` rows may still carry the legacy 0005 name; the
--  rename-bookkeeping ensures both names map to the same applied state.)
--
-- This file lives under `migrations/rollback/` so the tenant migration
-- runner (lib/migrator.ts loadMigrations) — which only reads the immediate
-- contents of `migrations/` — never auto-applies it.
--
-- TO APPLY MANUALLY:
--   turso db shell <tenant-db> < migrations/rollback/0009_camp_mob_species.down.sql
--   then:  DELETE FROM _migrations
--          WHERE name IN ('0005_camp_mob_species.sql', '0009_camp_mob_species.sql');
--
-- WARNING: The composite UNIQUE permits the same campId across species.
-- This rollback re-installs the GLOBAL UNIQUE on `campId`, so it WILL FAIL
-- with `UNIQUE constraint failed` if any tenant has created two camps with
-- the same campId under different species. Audit each tenant first:
--   SELECT campId, COUNT(*) AS n FROM Camp GROUP BY campId HAVING n > 1;
-- Resolve duplicates before applying.
--
-- libsql 0.6+ supports ALTER TABLE DROP COLUMN. If your runtime is older,
-- use the table-rebuild pattern instead (CREATE new table without species,
-- INSERT INTO new SELECT cols FROM old, DROP old, RENAME new).

DROP INDEX IF EXISTS Camp_species_idx;
DROP INDEX IF EXISTS Mob_species_idx;
DROP INDEX IF EXISTS Camp_species_campId_key;

CREATE UNIQUE INDEX IF NOT EXISTS Camp_campId_key ON Camp(campId);

ALTER TABLE Camp DROP COLUMN species;
ALTER TABLE Mob  DROP COLUMN species;
