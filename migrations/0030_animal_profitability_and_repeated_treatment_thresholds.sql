-- 0030_animal_profitability_and_repeated_treatment_thresholds.sql
--
-- Animal/Mob Profitability v1 (PRD grilling session 2026-06-19).
--
-- The per-animal / per-category / per-camp profitability views already ship but
-- are un-feedable and have no acquisition cost basis. This wave makes them
-- feedable: a first-class purchase-price attribute on Animal (so day-1
-- profitability is populated from imported attributes, not N hand-keyed
-- transactions), a per-animal sale-value override for the known exception (a
-- stud bull), and two per-farm thresholds for the new `repeated-treatments`
-- underperformer triage reason (count + rolling window), sitting beside the
-- existing `adgPoorDoerThreshold` / `daysOpenLimit` config columns.
--
-- Columns:
--   * Animal.purchasePrice  REAL  — total ZAR paid to acquire (null = home-bred)
--   * Animal.purchaseDate   TEXT  — acquisition date "YYYY-MM-DD" (String, not DateTime)
--   * Animal.estimatedValue REAL  — per-animal sale-value override (tier-3)
--   * FarmSettings.repeatedTreatmentWindowDays INTEGER NOT NULL DEFAULT 90
--   * FarmSettings.repeatedTreatmentCount      INTEGER NOT NULL DEFAULT 3
--
-- Discipline notes (mirror 0029_task_water_point_id.sql):
--   * Additive only — pure `ALTER TABLE … ADD COLUMN`. No DROP/RENAME, no
--     User/_migrations touch → within promote scope (runs on promote across
--     every tenant clone; nullable / constant-default ADD COLUMN is safe).
--   * Animal columns are NULLABLE, no backfill (a nullable ADD COLUMN needs no
--     server-side default). FarmSettings columns are NOT NULL with a constant
--     DEFAULT — legal in SQLite/libSQL (precedent: 0023 `quietHoursStart TEXT
--     DEFAULT '20:00'`) and required to mirror the Prisma `@default` so
--     `checkPrismaColumnParity` holds.
--   * Idempotency comes from the migrator's per-tenant `_migrations` bookkeeping
--     (lib/migrator.ts) — SQLite/libSQL has no `ADD COLUMN IF NOT EXISTS`;
--     re-running is prevented by the bookkeeping row, not per-statement guards.
--   * `verifyMigrationApplied` (#141) parses each ALTER and probes
--     pragma_table_info; on a silent miss the bookkeeping row rolls back so the
--     file re-runs next batch.
--   * `checkPrismaColumnParity` (#137) verifies the live columns match the
--     Prisma declarations in the same commit.
--   * Identifier quoting per feedback-quote-sql-keywords-in-migrations.md —
--     double-quote table + column identifiers.

ALTER TABLE "Animal" ADD COLUMN "purchasePrice" REAL;
ALTER TABLE "Animal" ADD COLUMN "purchaseDate" TEXT;
ALTER TABLE "Animal" ADD COLUMN "estimatedValue" REAL;
ALTER TABLE "FarmSettings" ADD COLUMN "repeatedTreatmentWindowDays" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "FarmSettings" ADD COLUMN "repeatedTreatmentCount" INTEGER NOT NULL DEFAULT 3;
