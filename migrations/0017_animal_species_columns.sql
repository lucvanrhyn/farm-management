-- 0017_animal_species_columns.sql
--
-- Add `species` and `speciesData` columns to the Animal table. See
-- 0016_pre_stamp_animal_species_columns.sql for the full incident
-- writeup and why this migration is split into pre-stamp + DDL.
--
-- Defaults match `prisma/schema.prisma`:
--   species      String  @default("cattle")
--   speciesData  String?
--
-- Constant defaults — Turso rejects `DEFAULT CURRENT_TIMESTAMP` on
-- ADD COLUMN as a non-constant default, so we use a literal string.
-- That's the same value Prisma applies at insert time for new rows
-- where species is omitted.
--
-- Tenants that already have these columns (added pre-rule-tightening
-- via `prisma db push`) skip this file entirely — see 0016.

ALTER TABLE "Animal" ADD COLUMN "species" TEXT NOT NULL DEFAULT 'cattle';
ALTER TABLE "Animal" ADD COLUMN "speciesData" TEXT;
