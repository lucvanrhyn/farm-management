-- wave/26-regulatory-hotfix: Add transport details to NvdRecord
-- Stock Theft Act 57/1959 §8: driver name + vehicle reg are mandatory fields
-- for a roadblock-compliant removal certificate.
--
-- Column is nullable (TEXT NULL) because existing records pre-date this field.
-- The NVD issue form (NvdIssueForm.tsx) MUST collect these fields going forward.
-- The NVD PDF renderer (nvd-pdf.ts) prints a "Transport details not provided"
-- empty-state message when this column is NULL, so existing records still
-- render correctly.

ALTER TABLE NvdRecord ADD COLUMN transportJson TEXT;
