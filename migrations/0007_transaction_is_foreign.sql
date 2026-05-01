-- 0007_transaction_is_foreign.sql
-- Foreign-derived flag on Transaction (wave/26e — refs #26 audit finding #22).
-- SARS source code 0192 (profit) / 0193 (loss) for foreign farming income on
-- the ITR12 Farming Schedule. Identifies SA tenants leasing cross-border
-- (Lesotho / Eswatini / etc.) so the schedule can split domestic vs foreign
-- onto the correct activity codes.
--
-- Nullable additive column with default 0 (false). libSQL/SQLite uses INTEGER
-- for booleans; Prisma serialises Boolean? to INTEGER on the wire.

ALTER TABLE Transaction ADD COLUMN isForeign INTEGER DEFAULT 0;
