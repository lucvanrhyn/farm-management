-- 0006_aia_tag_fields.sql
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
