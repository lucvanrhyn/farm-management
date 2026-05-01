-- 0007_transaction_is_foreign.sql
-- Foreign-derived flag on Transaction (wave/26e — refs #26 audit finding #22).
-- SARS source code 0192 (profit) / 0193 (loss) for foreign farming income on
-- the ITR12 Farming Schedule. Identifies SA tenants leasing cross-border
-- (Lesotho / Eswatini / etc.) so the schedule can split domestic vs foreign
-- onto the correct activity codes.
--
-- Nullable additive column with default 0 (false). libSQL/SQLite uses INTEGER
-- for booleans; Prisma serialises Boolean? to INTEGER on the wire.
--
-- `Transaction` MUST be double-quoted: it collides with the SQL reserved word
-- (BEGIN TRANSACTION / COMMIT TRANSACTION). Without quotes, the libSQL parser
-- emits `SQL_PARSE_ERROR: near TRANSACTION` and the prod-promote workflow
-- fails. The first version of this file shipped without quotes and crashed
-- the post-merge-promote run for #51 on 2026-05-01.

ALTER TABLE "Transaction" ADD COLUMN isForeign INTEGER DEFAULT 0;
