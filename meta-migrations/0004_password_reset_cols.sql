-- Meta-DB migration 0004: add password-reset token columns to `users`.
--
-- Issue #102 (slice 1): the forgot-password request flow mints a reset token
-- and persists it on the meta-DB user row. These are SEPARATE columns from the
-- email-verification pair (verification_token / verification_expires) — sharing
-- one token column across email-verify and password-reset would create a
-- cross-purpose token-confusion risk (a verify token could be replayed at the
-- /api/auth/reset-password endpoint, and vice versa). Distinct columns enforce
-- that boundary at the storage layer; the app code in lib/meta-db.ts reads/writes
-- only the password_reset_* pair for the reset flow.
--
-- Both columns are additive and nullable with no constraints, so SQLite can
-- ADD COLUMN in place without a table recreation and existing rows remain valid
-- (they simply carry NULL until a reset is requested). password_reset_expires
-- holds an ISO-8601 timestamp string.
--
-- Applied exactly once: the meta migration runner (lib/meta-migrator.ts) tracks
-- this file by name in `_meta_migrations` and skips it on subsequent runs, so
-- re-running `pnpm db:migrate` (or `scripts/migrate.ts --meta-only`) is a no-op.

ALTER TABLE users ADD COLUMN password_reset_token TEXT;
ALTER TABLE users ADD COLUMN password_reset_expires TEXT;
