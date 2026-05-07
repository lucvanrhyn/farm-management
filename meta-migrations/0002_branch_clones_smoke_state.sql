-- Meta-DB migration 0002: add post-promote smoke state to branch_db_clones.
--
-- PRD #128 (2026-05-06): the post-promote authenticated smoke and the
-- promote-rollback CLI both write to two new columns on `branch_db_clones`
-- so the meta-DB has an honest record of "did the smoke run, and what did
-- it conclude."
--
-- Column semantics:
--   last_smoke_status — ENUM-ish text: 'pending' | 'passed' | 'failed' | 'rolled_back'.
--                       Set by the post-promote-smoke step in
--                       post-merge-promote.yml after `pnpm ops:promote-branch`
--                       returns. `rollback-promote` writes 'rolled_back' when
--                       it clears `promoted_at`.
--   last_smoke_at     — ISO timestamp of the smoke run.
--
-- Both columns are nullable so historical rows pre-dating this migration
-- continue to read fine. New rows start with NULLs and are populated as
-- soon as the post-promote step runs.

ALTER TABLE branch_db_clones ADD COLUMN last_smoke_status TEXT;
ALTER TABLE branch_db_clones ADD COLUMN last_smoke_at TEXT;
