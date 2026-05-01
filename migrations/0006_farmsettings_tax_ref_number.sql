-- 0006_farmsettings_tax_ref_number.sql
-- SARS Tax Reference Number on FarmSettings (wave/26c — refs #26).
-- Nullable additive column; no backfill needed.

ALTER TABLE FarmSettings ADD COLUMN taxReferenceNumber TEXT;
