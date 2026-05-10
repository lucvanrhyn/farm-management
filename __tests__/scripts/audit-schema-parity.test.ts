// @vitest-environment node
/**
 * Tests for scripts/audit-schema-parity.ts — specifically the
 * `resolveExpectedMigrations(deps)` helper that decides which migration files
 * tenants are expected to have applied.
 *
 * The motivating bug (PR #183, 2026-05-10): the gate read the migration list
 * from the PR-branch working tree, so any PR that *adds* a new migration
 * failed by construction (the new file is on the branch but tenants have not
 * yet been promoted, so they appear "missing"). PR #183 was the first
 * new-migration PR since the parity gate (PRD #128) was instituted, and it
 * stalled within 2 minutes of opening. Audit of PRs #136-#182 confirms the
 * gate had never been exercised against this scenario — classic
 * `feedback-ci-workflow-real-run.md` failure mode.
 *
 * The fix: compare tenant `_migrations` against the migration set merged on
 * `origin/main`, not the PR-branch working tree. New-in-PR files are
 * excluded; existing-in-main-but-missing-on-tenant continues to fail (real
 * drift).
 *
 * `resolveExpectedMigrations(deps)` is the single point of truth: it returns
 * the list of migration filenames the tenants are expected to have. In CI,
 * `deps.gitListBaseRefMigrations` calls `git ls-tree -r --name-only origin/main migrations/`.
 * Locally / on forks where origin/main isn't fetched, the helper falls back
 * to the working-tree migration list (`deps.fsLoadMigrationsFromWorkingTree`).
 *
 * Tests use the exported `resolveExpectedMigrations(deps)` with injected
 * fakes — no real `git` invocation, no filesystem walk.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveExpectedMigrations,
  type ResolveExpectedMigrationsDeps,
} from '@/scripts/audit-schema-parity';

function makeDeps(
  overrides?: Partial<ResolveExpectedMigrationsDeps>,
): ResolveExpectedMigrationsDeps {
  return {
    gitListBaseRefMigrations: vi.fn(async () => null),
    fsLoadMigrationsFromWorkingTree: vi.fn(async () => []),
    log: vi.fn(),
    ...overrides,
  };
}

describe('resolveExpectedMigrations — base-ref aware', () => {
  it('returns the migration set merged on origin/main, ignoring new-in-PR files', async () => {
    // Simulates PR #183's scenario: working tree has 0001..0017 plus the new
    // 0018, but origin/main only has 0001..0017. Tenants are only expected to
    // have what's on main, so 0018 must be excluded from the missing-check.
    //
    // `gitListBaseRefMigrations` returns raw paths from `git ls-tree -r`,
    // which include the `migrations/` prefix. The helper strips the prefix
    // and returns leaf .sql filenames.
    const onMainNames = [
      '0001_init.sql',
      '0014_einstein_chunker_version.sql',
      '0015_payfast_events_applied_at.sql',
      '0016_pre_stamp_animal_species_columns.sql',
      '0017_animal_species_columns.sql',
    ];
    const onMainPaths = onMainNames.map((n) => `migrations/${n}`);
    const onWorkingTree = [...onMainNames, '0018_it3_snapshot.sql'];

    const deps = makeDeps({
      gitListBaseRefMigrations: vi.fn(async () => onMainPaths),
      fsLoadMigrationsFromWorkingTree: vi.fn(async () => onWorkingTree),
    });

    const expected = await resolveExpectedMigrations(deps);

    expect(expected).toEqual(onMainNames);
    expect(expected).not.toContain('0018_it3_snapshot.sql');
    expect(deps.gitListBaseRefMigrations).toHaveBeenCalledTimes(1);
    expect(deps.fsLoadMigrationsFromWorkingTree).not.toHaveBeenCalled();
  });

  it('returns the merged set when the PR removes a migration from main (rare; should still flag if tenants are missing it)', async () => {
    // Defensive: even if a PR deletes a migration locally, tenants are still
    // expected to have everything that was on main pre-rebase. Removed-in-PR
    // is also a different drift class but the gate's job is to verify
    // tenants vs main, not vs the PR's intent.
    const onMainNames = ['0001_init.sql', '0002_old_thing.sql'];
    const onMainPaths = onMainNames.map((n) => `migrations/${n}`);
    const onWorkingTree = ['0001_init.sql']; // PR deleted 0002

    const deps = makeDeps({
      gitListBaseRefMigrations: vi.fn(async () => onMainPaths),
      fsLoadMigrationsFromWorkingTree: vi.fn(async () => onWorkingTree),
    });

    const expected = await resolveExpectedMigrations(deps);

    // Still expects 0002 — tenants were promoted with it; the PR's deletion
    // is a separate concern (a future PR would have to also drop it from
    // tenants via a migration).
    expect(expected).toEqual(onMainNames);
  });

  it('falls back to the working-tree list when origin/main is unreachable (forks, fresh clones without fetch-depth: 0)', async () => {
    const onWorkingTree = ['0001_init.sql', '0002_thing.sql'];
    const deps = makeDeps({
      gitListBaseRefMigrations: vi.fn(async () => null), // signals "git couldn't list base ref"
      fsLoadMigrationsFromWorkingTree: vi.fn(async () => onWorkingTree),
    });

    const expected = await resolveExpectedMigrations(deps);

    expect(expected).toEqual(onWorkingTree);
    expect(deps.fsLoadMigrationsFromWorkingTree).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringMatching(/origin\/main not reachable|falling back to working tree/i),
    );
  });

  it('only returns .sql filenames (filters out READMEs, rollback subdir entries, etc.)', async () => {
    // git ls-tree -r returns all paths under migrations/ — including any
    // README.md or files under migrations/rollback/. The helper must filter
    // to leaf .sql files in migrations/ so the resulting list matches what
    // `lib/migrator.ts loadMigrations()` produces.
    const fromGit = [
      'migrations/0001_init.sql',
      'migrations/0002_thing.sql',
      'migrations/README.md',
      'migrations/rollback/0001_init_rollback.sql',
    ];
    const deps = makeDeps({
      // Note the helper will receive raw paths from `git ls-tree` and must
      // strip the `migrations/` prefix and filter rollback/non-.sql entries.
      gitListBaseRefMigrations: vi.fn(async () => fromGit),
    });

    const expected = await resolveExpectedMigrations(deps);

    expect(expected).toEqual(['0001_init.sql', '0002_thing.sql']);
  });

  it('handles git returning an empty list (zero merged migrations) without crashing', async () => {
    // Edge case: brand-new repo with no migrations yet shipped to main.
    // gitListBaseRefMigrations returns []. This is *not* the same as
    // "git was unreachable" (null). An empty merged set means tenants
    // legitimately have nothing applied yet.
    const deps = makeDeps({
      gitListBaseRefMigrations: vi.fn(async () => []),
      fsLoadMigrationsFromWorkingTree: vi.fn(async () => ['0001_new_in_pr.sql']),
    });

    const expected = await resolveExpectedMigrations(deps);

    expect(expected).toEqual([]);
    // Did NOT fall back to working tree — empty merged set is a real answer.
    expect(deps.fsLoadMigrationsFromWorkingTree).not.toHaveBeenCalled();
  });
});
