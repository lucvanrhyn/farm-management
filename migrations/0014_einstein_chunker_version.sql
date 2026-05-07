-- 0014_einstein_chunker_version.sql
-- Issue #99: Add updatedAt to Camp/Animal/Task (stale detection timestamps)
-- and add chunker_version + content_hash to EinsteinChunk (invalidation columns).
--
-- Soak window: ≥24h on preview before promoting to prod (schema change).
--
-- Wave/132 rewrite (2026-05-07, issue #132):
--
-- The original file used `DEFAULT CURRENT_TIMESTAMP` on ALTER TABLE ADD COLUMN
-- for the three updatedAt columns. Turso/libSQL **rejects** this:
-- CURRENT_TIMESTAMP is a non-constant default, and the SQLite parser only
-- accepts constant expressions on ADD COLUMN (`SQLITE_ERROR: Cannot add a
-- column with non-constant default`).
--
-- This silently failed on `delta-livestock` and `acme-cattle` during
-- Wave 0 stress testing, leaving those tenants without the `updatedAt`
-- columns. Every Prisma `findMany()` on Camp/Animal/Task crashed with
-- `no such column: updatedAt` because Prisma materialises every column
-- declared in the schema. That's the C1 root cause from the 2026-05-06
-- stress test report.
--
-- Pattern: ADD COLUMN with a constant literal default, then immediately
-- UPDATE all rows to CURRENT_TIMESTAMP. Same value Prisma's `@updatedAt`
-- writes on insert. Idempotent — a second run sees the constant sentinel
-- already overwritten and updates zero rows.
--
-- For tenants that already have these columns (every prod tenant as of
-- 2026-05-07): the migrator skips this file entirely via the `_migrations`
-- row check. Rewriting the file in place is invisible to them. For fresh
-- tenants (next onboarding), the rewritten file applies cleanly.

-- ─── EinsteinChunk: chunker version + content hash ──────────────────────────
ALTER TABLE "EinsteinChunk" ADD COLUMN "chunkerVersion" TEXT NOT NULL DEFAULT '0';
ALTER TABLE "EinsteinChunk" ADD COLUMN "contentHash"    TEXT NOT NULL DEFAULT '';

-- ─── Camp: updatedAt change-tracking ────────────────────────────────────────
ALTER TABLE "Camp" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00';
UPDATE "Camp" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" = '1970-01-01 00:00:00';

-- ─── Animal: updatedAt change-tracking ──────────────────────────────────────
ALTER TABLE "Animal" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00';
UPDATE "Animal" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" = '1970-01-01 00:00:00';

-- ─── Task: updatedAt change-tracking ────────────────────────────────────────
ALTER TABLE "Task" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00';
UPDATE "Task" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" = '1970-01-01 00:00:00';
