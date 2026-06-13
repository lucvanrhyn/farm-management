-- Meta-DB migration 0006: shared rate-limit counter table.
--
-- Findings api-M2 / OB-003 / auth-M3 / auth-F1 (S28). The previous limiter
-- (lib/rate-limit.ts) was an in-memory Map: on serverless (Vercel) each
-- instance kept its OWN sliding window and cold starts wiped it, so the cap
-- was per-instance rather than global. An attacker spreading requests across
-- instances bypassed the limit on auth / import / Einstein endpoints.
--
-- The fix moves the counter into a single shared META-DB row per key, making
-- it authoritative across all instances at zero new infra/cost (the META DB
-- already exists). lib/rate-limit.ts now runs a single atomic
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING fixed-window upsert against
-- this table; see that file for the window semantics.
--
-- Schema: `key` is the limiter key (e.g. `login:<identifier>`,
-- `import:<userId>`); `windowStartMs` is the epoch-ms start of the current
-- fixed window; `count` is the number of hits inside it. INTEGER columns hold
-- millisecond timestamps and counts. CREATE TABLE IF NOT EXISTS so the
-- migration is a no-op on any META DB that already has the table (e.g. a fresh
-- DB seeded by scripts/seed-meta-db.ts createTables(), which carries the same
-- DDL for parity).
--
-- Applied exactly once: the meta migration runner (lib/meta-migrator.ts)
-- tracks this file by name in `_meta_migrations` and skips it on subsequent
-- runs, so re-running `pnpm db:migrate` (or `scripts/migrate.ts --meta-only`)
-- is a no-op.

CREATE TABLE IF NOT EXISTS "RateLimit" (
  "key"           TEXT PRIMARY KEY,
  "windowStartMs" INTEGER NOT NULL,
  "count"         INTEGER NOT NULL
);
