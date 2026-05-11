-- 0020_animal_cover_idempotency.sql
--
-- Issue #207 — end-to-end Animal + CampCoverReading idempotency.
--
-- Bug class (same shape as #206): offline-sync replays (network blip, timeout,
-- browser close mid-flight) currently re-POST the same Animal create / cover
-- reading as a fresh row because neither domain op has an idempotency key.
-- Two POSTs with identical payload create two rows.
--
-- Fix shape — mirrors migration 0019_observation_idempotency.sql one-for-one
-- (the pattern established by PR #214 / issue #206):
--   1. Client form generates `crypto.randomUUID()` at mount.
--   2. UUID submitted as `clientLocalId` on the POST body.
--   3. This migration adds a `clientLocalId TEXT` column + UNIQUE INDEX on
--      BOTH `Animal` and `CampCoverReading` (one migration file, two tables —
--      the slice is a single conceptual unit per the parent task brief).
--   4. The domain ops (`lib/domain/animals/create-animal.ts`,
--      `lib/domain/cover/create-cover-reading.ts`) call
--      `prisma.<model>.upsert({ where: { clientLocalId }, create, update: {} })`
--      so a retry returns the original row's id (200, not 409, not duplicate).
--   5. The offline-sync queue (`lib/sync-manager.ts` + `lib/offline-store.ts`)
--      replays the queued row with its ORIGINAL `clientLocalId`, not a fresh
--      UUID — that is the contract that makes the idempotency hold across
--      network failures, browser reloads, and concurrent retries.
--
-- Discipline notes (identical to migration 0019):
--   * Identifier quoting per feedback-quote-sql-keywords-in-migrations.md.
--   * Both columns are NULLABLE — legacy rows pre-#207 stay valid; only freshly
--     submitted rows from the new client code carry a UUID. This makes each
--     UNIQUE INDEX safe under SQLite semantics (multiple NULLs allowed in
--     a UNIQUE index).
--   * CREATE UNIQUE INDEX uses IF NOT EXISTS so a re-run against a partially
--     migrated tenant (e.g. operator manually pre-created an index) is a no-op.
--     The ALTER TABLE itself is NOT guarded — SQLite has no
--     `ADD COLUMN IF NOT EXISTS`. The canonical migrator (lib/migrator.ts +
--     `_migrations` bookkeeping) runs each file at most once per tenant
--     atomically, so partial-apply is structurally impossible.
--   * Per-tenant Turso DB architecture means the PRD's
--     `@@unique([farmId, clientLocalId])` collapses to `@unique` on
--     `clientLocalId` for each table — there are no shared `Animal` or
--     `CampCoverReading` tables across farms. The scope is implicit in the
--     DB connection. Documented also in the PR body, mirroring the #206 /
--     #214 precedent.
--   * The `verifyMigrationApplied` probe (PRD #128 #141) parses the
--     ALTER TABLE statements and probes pragma_table_info; if Turso silently
--     fails to apply, the bookkeeping row is rolled back so the file re-runs
--     on the next batch.
--
-- Slice scope: Animal + CampCoverReading. Observation idempotency shipped
-- separately under #206 / migration 0019. Future write surfaces (Mob,
-- Transaction, Task) will follow the same one-migration-per-slice pattern.

ALTER TABLE "Animal" ADD COLUMN "clientLocalId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_animal_client_local_id"
  ON "Animal" ("clientLocalId");

ALTER TABLE "CampCoverReading" ADD COLUMN "clientLocalId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_camp_cover_reading_client_local_id"
  ON "CampCoverReading" ("clientLocalId");
