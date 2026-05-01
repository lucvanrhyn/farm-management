-- 0012_farmsettings_tax_ref_number.sql
-- Renumbered from 0006 → 0012 in wave/56 to break a prefix collision with
-- 0006_aia_tag_fields.sql. See 0008_record_legacy_renames.sql.
--
-- SARS Tax Reference Number on FarmSettings (wave/26c — refs #26).
-- Nullable additive column; no backfill needed.

ALTER TABLE FarmSettings ADD COLUMN taxReferenceNumber TEXT;
