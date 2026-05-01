-- 0011_aia_tag_fields.sql
-- Renumbered from 0006 → 0011 in wave/56 to break a prefix collision with
-- 0006_farmsettings_tax_ref_number.sql. See 0008_record_legacy_renames.sql.
--
-- AIA 2002 compliance — wave/26d (refs #26).
-- Adds DALRRD-registered identification mark to FarmSettings + per-animal
-- tag and brand sequence to Animal. All nullable, no backfill needed.
--
-- Legal basis:
--   * Animal Identification Act 6 of 2002
--   * DALRRD BrandsAIS registry (3-character mark per farm)
--   * Required on every NVD / Removal Certificate at roadblock inspection.

ALTER TABLE FarmSettings ADD COLUMN aiaIdentificationMark TEXT;
ALTER TABLE Animal       ADD COLUMN tagNumber             TEXT;
ALTER TABLE Animal       ADD COLUMN brandSequence         TEXT;
