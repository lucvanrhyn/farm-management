-- wave/26b — SARS opening/closing stock at standard values + ±20% election
-- First Schedule paragraph 6(1)(b)/(c)/(d)(ii) read with paragraph 7:
--   The taxpayer may adopt their own value within ±20% of the gazetted standard
--   value. Once adopted, the election is binding for all subsequent returns
--   (paragraph 7) and may not be varied without SARS approval.
--
-- This table stores per-class adopted values per tax year. The IT3 PDF
-- renderer applies the election to the stock-block valuation and surfaces
-- the citation in the footer ("Per First Schedule paragraph 6 …").
--
-- Operator-only undo: drop the table.

CREATE TABLE IF NOT EXISTS "SarsLivestockElection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "species" TEXT NOT NULL,
  "ageCategory" TEXT NOT NULL,
  "electedValueZar" INTEGER NOT NULL,
  "electedYear" INTEGER NOT NULL,
  "sarsChangeApprovalRef" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SarsLivestockElection_class_year_key"
  ON "SarsLivestockElection" ("species", "ageCategory", "electedYear");

CREATE INDEX IF NOT EXISTS "SarsLivestockElection_class_idx"
  ON "SarsLivestockElection" ("species", "ageCategory");
