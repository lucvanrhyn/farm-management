-- 0008_record_legacy_renames.sql
-- wave/56 SEV-1 migration-drift hotfix.
--
-- Background. Until wave/56 the `migrations/` directory shipped with two pairs
-- of files that shared the same numeric prefix:
--
--   0005_camp_mob_species.sql  +  0005_sars_livestock_election.sql
--   0006_aia_tag_fields.sql    +  0006_farmsettings_tax_ref_number.sql
--
-- The migration runner (`lib/migrator.ts`) sorts files via `localeCompare` and
-- keys `_migrations.name` on the full filename. With a colliding prefix the
-- two files in a pair are interleaved by the secondary characters of their
-- name — a stable but fragile order. The 2026-05-01 `post-merge-promote` for
-- wave/26e crashed mid-batch on one tenant and never re-ran cleanly, leaving
-- production with at least one column from each pair missing.
--
-- The fix has two halves: code (collision detection in `loadMigrations`) and
-- data (renumber the colliding files to disjoint prefixes 0009..0012). This
-- file bridges the data half: it stamps the NEW filenames as applied for any
-- tenant that already applied the OLD filename, so the renamed files are
-- skipped on the next migrate run rather than re-applied (which would crash
-- because `ALTER TABLE … ADD COLUMN` is not idempotent on SQLite).
--
-- Idempotency. `INSERT OR IGNORE` is a no-op once the row exists. The `WHERE
-- EXISTS` guard ensures we only stamp the new name if the old name was
-- actually applied — fresh tenants (clones provisioned after the rename) see
-- neither row, so this file does nothing for them and they apply the
-- 0009..0012 files normally.
--
-- This file MUST sort before the renamed files; that's why it is `0008_*`.

INSERT OR IGNORE INTO "_migrations" (name, applied_at)
SELECT '0009_camp_mob_species.sql', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "_migrations" WHERE name = '0005_camp_mob_species.sql');

INSERT OR IGNORE INTO "_migrations" (name, applied_at)
SELECT '0010_sars_livestock_election.sql', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "_migrations" WHERE name = '0005_sars_livestock_election.sql');

INSERT OR IGNORE INTO "_migrations" (name, applied_at)
SELECT '0011_aia_tag_fields.sql', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "_migrations" WHERE name = '0006_aia_tag_fields.sql');

INSERT OR IGNORE INTO "_migrations" (name, applied_at)
SELECT '0012_farmsettings_tax_ref_number.sql', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "_migrations" WHERE name = '0006_farmsettings_tax_ref_number.sql');
