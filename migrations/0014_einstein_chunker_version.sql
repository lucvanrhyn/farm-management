-- 0014_einstein_chunker_version.sql
-- Issue #99: Add updatedAt to Camp/Animal/Task (stale detection timestamps)
-- and add chunker_version + content_hash to EinsteinChunk (invalidation columns).
--
-- Soak window: ≥24h on preview before promoting to prod (schema change).
-- Safe to run multiple times — ADD COLUMN on existing rows back-fills NULL/default.

-- ─── EinsteinChunk: chunker version + content hash ──────────────────────────
ALTER TABLE "EinsteinChunk" ADD COLUMN "chunkerVersion" TEXT NOT NULL DEFAULT '0';
ALTER TABLE "EinsteinChunk" ADD COLUMN "contentHash"    TEXT NOT NULL DEFAULT '';

-- ─── Camp: updatedAt change-tracking ────────────────────────────────────────
ALTER TABLE "Camp" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ─── Animal: updatedAt change-tracking ──────────────────────────────────────
ALTER TABLE "Animal" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ─── Task: updatedAt change-tracking ────────────────────────────────────────
ALTER TABLE "Task" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
