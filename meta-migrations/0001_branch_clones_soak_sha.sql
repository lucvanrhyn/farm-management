-- Meta-DB migration 0001: add soak-gate columns to branch_db_clones.
--
-- Issue #101 fix: the previous soak gate keyed on `created_at` (branch clone
-- creation time), allowing a force-push or re-push to a long-lived branch to
-- bypass the soak requirement. These two columns store the commit SHA that last
-- passed CI and the timestamp when that CI run completed so the gate can verify
-- that the SPECIFIC commit being promoted has soaked, not just the branch clone.
--
-- Column semantics:
--   head_sha        — full or short commit SHA stamped by recordCiPassForCommit
--                     when CI finishes for a given branch + commit combination.
--   soak_started_at — ISO timestamp of when CI passed for head_sha.
--                     promoteToProd measures elapsed time from this column,
--                     not from created_at, when a headSha is provided.
--
-- Both columns are nullable for backward compatibility with existing rows that
-- pre-date this migration. When null, promoteToProd falls back to the legacy
-- created_at-based gate.
--
-- SQLite ALTER TABLE ADD COLUMN is idempotent when the column does not exist,
-- but will error if the column already exists. The runner's tracking table
-- (_meta_migrations) guarantees this file is applied at most once, so the
-- statements below do not need IF NOT EXISTS guards.

ALTER TABLE branch_db_clones ADD COLUMN head_sha TEXT;
ALTER TABLE branch_db_clones ADD COLUMN soak_started_at TEXT
