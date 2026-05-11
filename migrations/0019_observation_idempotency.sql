-- 0019_observation_idempotency.sql
--
-- Issue #206 — end-to-end observation idempotency.
--
-- Bug class: offline-sync replays (network blip, timeout, browser close
-- mid-flight) currently re-POST the same observation as a fresh row because
-- the domain op had no idempotency key. Two POSTs with identical payload
-- created two `Observation` rows.
--
-- Fix shape (USER-APPROVED pattern):
--   1. Client form generates `crypto.randomUUID()` at mount.
--   2. UUID submitted as `clientLocalId` on the POST body.
--   3. This migration adds `Observation.clientLocalId TEXT` + a UNIQUE index.
--   4. The domain op (`lib/domain/observations/create-observation.ts`) calls
--      `prisma.observation.upsert({ where: { clientLocalId }, create, update: {} })`
--      so a retry returns the original row's id (200, not 409, not duplicate).
--   5. The offline-sync queue (`lib/sync-manager.ts` + `lib/offline-store.ts`)
--      replays the queued row with its ORIGINAL `clientLocalId`, not a fresh
--      UUID — that is the contract that makes the idempotency hold across
--      network failures, browser reloads, and concurrent retries.
--
-- Discipline notes:
--   * Identifier quoting per feedback-quote-sql-keywords-in-migrations.md.
--   * Column is NULLABLE — legacy rows pre-#206 stay valid; only freshly-
--     submitted rows from the new logger code carry a UUID. This makes the
--     UNIQUE INDEX safe under SQLite semantics (multiple NULLs allowed in
--     a UNIQUE index).
--   * CREATE UNIQUE INDEX uses IF NOT EXISTS so a re-run against a partially
--     migrated tenant (e.g. operator manually pre-created the index) is a
--     no-op. The ALTER TABLE itself is NOT guarded — SQLite has no
--     `ADD COLUMN IF NOT EXISTS`. The canonical migrator (lib/migrator.ts +
--     `_migrations` bookkeeping) runs each file at most once per tenant
--     atomically, so partial-apply is structurally impossible.
--   * Per-tenant Turso DB architecture means `@@unique([farmId, clientLocalId])`
--     in the original PRD collapses to `@unique` on `clientLocalId` here —
--     there is no shared `Observation` table. The scope is implicit.
--   * The `verifyMigrationApplied` probe (PRD #128 #141) parses the
--     ALTER TABLE statement and probes pragma_table_info; if Turso silently
--     fails to apply, the bookkeeping row is rolled back so the file re-runs
--     on the next batch.
--
-- Slice scope: Observation only. The Animal + Cover slice ships under #207
-- using the same pattern (separate migration, separate domain ops).

ALTER TABLE "Observation" ADD COLUMN "clientLocalId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_observation_client_local_id"
  ON "Observation" ("clientLocalId");
