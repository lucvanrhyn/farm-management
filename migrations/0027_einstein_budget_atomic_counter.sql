-- 0027_einstein_budget_atomic_counter.sql
--
-- EIN-1 (slice S23) — make the Farm Einstein monthly budget counter atomic
-- under concurrency.
--
-- ROOT CAUSE: lib/einstein/budget.ts stored the volatile monthly spend counter
-- as JSON inside FarmSettings.aiSettings (a plain String column). All three
-- writers (stampCostBeforeSend / reconcileCostAfterSend / resetMonthlyBudget)
-- did a non-atomic read-modify-write: read the whole blob, mutate
-- ragConfig.monthSpentZar, overwrite the whole blob. Two concurrent Einstein
-- queries both read spent=50 and both wrote 50+cost → one increment was LOST →
-- the budget undercounted → AI overspend. You cannot atomically increment a
-- number buried in a JSON string column.
--
-- FIX: extract the volatile counter (and the month key it belongs to) into
-- dedicated first-class columns so the writers can use single-statement atomic
-- SQL (`UPDATE … SET "aiBudgetMonthSpentZar" = "aiBudgetMonthSpentZar" + ?`).
-- The DB serializes the statement; concurrent increments compose instead of
-- clobbering. The CAP + kill-switch stay in the aiSettings JSON ragConfig
-- (rarely written, admin-form only) — minimal blast radius.
--
-- Discipline notes (mirror 0026_observation_notes.sql):
--   * Additive only — two `ALTER TABLE … ADD COLUMN` on FarmSettings plus a
--     one-time backfill UPDATE. No DROP/RENAME, no User/_migrations touch →
--     within promote scope (runs on promote across every tenant clone).
--   * "aiBudgetMonthSpentZar" is NOT NULL with a server-side DEFAULT 0, which
--     SQLite/libSQL's `ALTER TABLE ADD COLUMN NOT NULL` requires; the Prisma
--     declaration is `Float @default(0)` so column parity holds.
--   * "aiBudgetMonthKey" is NULLABLE (no default) — a fresh tenant has no
--     window yet; the budget module treats a NULL/stale key as "0 spent this
--     month" and the first stamp writes the live key. Matches the Prisma
--     `String?` declaration.
--   * BACKFILL: live tenants already carry a spend value inside the JSON blob.
--     We copy it across so the migration is lossless — without this every
--     active farm's running monthly spend would silently reset to 0 on promote.
--     `json_extract` reads ragConfig.monthSpentZar / ragConfig.currentMonthKey
--     from the OLD blob shape (the JSON still physically contains those keys on
--     pre-migration tenants; the app simply stops reading/writing them after
--     this slice). COALESCE(…, 0) guards a missing/non-numeric spend value, and
--     the WHERE clause skips tenants with a NULL aiSettings (they keep the
--     DEFAULT 0 + NULL key the ADD COLUMN gave them).
--   * Idempotency is provided by the migrator's per-tenant `_migrations`
--     bookkeeping table (`lib/migrator.ts`): each file runs exactly once per
--     tenant DB inside an atomic batch. SQLite/libSQL has no
--     `ADD COLUMN IF NOT EXISTS`; re-running is prevented by the bookkeeping
--     row, not per-statement guards.
--   * `verifyMigrationApplied` (#141) parses the ALTERs and probes
--     pragma_table_info; on a silent libSQL miss the bookkeeping row is rolled
--     back so the file re-runs next batch.
--   * `checkPrismaColumnParity` (#137) verifies the live DB columns match the
--     Prisma schema declarations in the same commit
--     (FarmSettings.aiBudgetMonthSpentZar / .aiBudgetMonthKey).
--   * Identifier quoting per feedback-quote-sql-keywords-in-migrations.md —
--     project convention double-quotes table/column identifiers in hand-written
--     migrations.

ALTER TABLE "FarmSettings" ADD COLUMN "aiBudgetMonthSpentZar" REAL NOT NULL DEFAULT 0;
ALTER TABLE "FarmSettings" ADD COLUMN "aiBudgetMonthKey" TEXT;

UPDATE "FarmSettings"
SET "aiBudgetMonthSpentZar" = COALESCE(CAST(json_extract("aiSettings", '$.ragConfig.monthSpentZar') AS REAL), 0),
    "aiBudgetMonthKey" = json_extract("aiSettings", '$.ragConfig.currentMonthKey')
WHERE "aiSettings" IS NOT NULL;
