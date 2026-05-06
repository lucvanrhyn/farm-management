// @vitest-environment node
/**
 * Tests for scripts/branch-clone.ts — the CLI entry point for the Option C
 * Turso per-branch DB clone provisioner.
 *
 * All tests use the exported `runCli(argv, deps)` function with injected fakes
 * for the three impl functions, stdout/stderr sinks, and the exit callback.
 * No real Turso binary or network calls are made.
 *
 * Test plan:
 *   clone
 *     1. Happy path: argv parsed, impl invoked with right input, stdout JSON, exit 0
 *     2. Missing --source: stderr usage, exit 1, impl NOT called
 *     3. --prefix custom: prefix passed through to impl
 *     4. TursoCliError: stderr captures error, exit 2, no JSON on stdout
 *   destroy
 *     5. Happy path: stdout JSON, exit 0
 *     6. --skip-turso flag passed through
 *     7. TursoCliError from destroy: stderr + exit 2
 *   promote
 *     8. Happy path with default soak
 *     9. --min-soak-hours 2 parsed and passed through
 *    10. --force-skip-soak parsed and passed through
 *    11. SoakNotMetError: stderr has elapsed + threshold, exit 1
 *    12. BranchCloneNotFoundError: exit 1
 *    13. Unexpected error from promote: exit 2
 *   meta
 *    14. --help prints usage to stdout, exit 0
 *    15. No subcommand prints usage to stdout, exit 0
 *    16. Unknown subcommand: exit 1, stderr has message
 */

import { describe, it, expect, vi } from 'vitest';
import { runCli, type CliDeps } from '@/scripts/branch-clone';
import { TursoCliError } from '@/lib/ops/turso-cli';
import {
  SoakNotMetError,
  BranchCloneNotFoundError,
} from '@/lib/ops/branch-clone';
import type {
  CloneBranchInput,
  CloneBranchResult,
  DestroyBranchDbInput,
  DestroyBranchDbResult,
  PromoteToProdInput,
  PromoteToProdResult,
} from '@/lib/ops/branch-clone';

// ── Fake builders ─────────────────────────────────────────────────────────────

function makeCloneResult(overrides?: Partial<CloneBranchResult>): CloneBranchResult {
  return {
    branchName: 'wave/19-option-c',
    tursoDbName: 'ft-clone-wave-19-option-c-abc123',
    tursoDbUrl: 'libsql://ft-clone-wave-19-option-c-abc123.turso.io',
    tursoAuthToken: 'secret-token',
    alreadyExisted: false,
    ...overrides,
  };
}

function makeDestroyResult(overrides?: Partial<DestroyBranchDbResult>): DestroyBranchDbResult {
  return {
    branchName: 'wave/19-option-c',
    tursoDestroyed: true,
    metaRowDeleted: true,
    ...overrides,
  };
}

function makePromoteResult(overrides?: Partial<PromoteToProdResult>): PromoteToProdResult {
  return {
    branchName: 'wave/19-option-c',
    prodMigrationAppliedFiles: ['0001_init.sql'],
    prodMigrationSkippedFiles: [],
    promotedAt: '2026-04-28T10:00:00.000Z',
    parityResults: [],
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<CliDeps>): CliDeps & {
  stdoutLines: string[];
  stderrLines: string[];
  exitCode: number | undefined;
} {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let exitCode: number | undefined;

  return {
    cloneBranchImpl: vi.fn(),
    destroyBranchDbImpl: vi.fn(),
    promoteToProdImpl: vi.fn(),
    recordCiPassForCommitImpl: vi.fn(),
    stdout: (s: string) => stdoutLines.push(s),
    stderr: (s: string) => stderrLines.push(s),
    exit: (code: number) => { exitCode = code; },
    stdoutLines,
    stderrLines,
    get exitCode() { return exitCode; },
    ...overrides,
  };
}

// ── clone ─────────────────────────────────────────────────────────────────────

describe('runCli clone', () => {
  it('happy path: parses argv, calls impl with right input, emits JSON, exits 0', async () => {
    const cloneResult = makeCloneResult();
    const deps = makeDeps({
      cloneBranchImpl: vi.fn().mockResolvedValue(cloneResult),
    });

    const code = await runCli(
      ['clone', 'wave/19-option-c', '--source', 'basson-boerdery'],
      deps,
    );

    expect(code).toBe(0);
    expect(deps.cloneBranchImpl).toHaveBeenCalledOnce();

    const callArg = (deps.cloneBranchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as CloneBranchInput;
    expect(callArg.branchName).toBe('wave/19-option-c');
    expect(callArg.sourceDbName).toBe('basson-boerdery');
    expect(callArg.cliPrefix).toBe('ft-clone'); // default

    expect(deps.stdoutLines).toHaveLength(1);
    const output = JSON.parse(deps.stdoutLines[0]);
    expect(output.branchName).toBe('wave/19-option-c');
    expect(output.tursoDbName).toBe(cloneResult.tursoDbName);
    expect(output.tursoDbUrl).toBe(cloneResult.tursoDbUrl);
    expect(output.alreadyExisted).toBe(false);
    // Auth token must NOT appear in stdout output (log safety)
    expect(deps.stdoutLines[0]).not.toContain('secret-token');

    expect(deps.stderrLines).toHaveLength(0);
  });

  it('missing --source: stderr contains usage, exit 1, impl not called', async () => {
    const deps = makeDeps({
      cloneBranchImpl: vi.fn(),
    });

    const code = await runCli(['clone', 'wave/19-option-c'], deps);

    expect(code).toBe(1);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.stderrLines.join('\n')).toMatch(/--source/i);
    expect(deps.stdoutLines).toHaveLength(0);
  });

  it('missing branch name: stderr contains usage, exit 1, impl not called', async () => {
    const deps = makeDeps({
      cloneBranchImpl: vi.fn(),
    });

    const code = await runCli(['clone', '--source', 'basson-boerdery'], deps);

    expect(code).toBe(1);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.stderrLines.join('\n')).toMatch(/branch/i);
  });

  it('--prefix custom: prefix passed through to impl', async () => {
    const deps = makeDeps({
      cloneBranchImpl: vi.fn().mockResolvedValue(makeCloneResult()),
    });

    const code = await runCli(
      ['clone', 'wave/19-option-c', '--source', 'basson-boerdery', '--prefix', 'my-clone'],
      deps,
    );

    expect(code).toBe(0);
    const callArg = (deps.cloneBranchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as CloneBranchInput;
    expect(callArg.cliPrefix).toBe('my-clone');
  });

  it('TursoCliError: stderr captures error message, exit 2, no JSON on stdout', async () => {
    const tursoErr = new TursoCliError(
      ['db', 'create', 'ft-clone-abc', '--from-db', 'src'],
      1,
      'network timeout',
    );
    const deps = makeDeps({
      cloneBranchImpl: vi.fn().mockRejectedValue(tursoErr),
    });

    const code = await runCli(
      ['clone', 'wave/19-option-c', '--source', 'basson-boerdery'],
      deps,
    );

    expect(code).toBe(2);
    expect(deps.stdoutLines).toHaveLength(0);
    const errOutput = deps.stderrLines.join('\n');
    expect(errOutput).toMatch(/TursoCliError|turso|network timeout/i);
  });

  it('alreadyExisted=true: JSON reflects existing clone', async () => {
    const deps = makeDeps({
      cloneBranchImpl: vi.fn().mockResolvedValue(makeCloneResult({ alreadyExisted: true })),
    });

    const code = await runCli(
      ['clone', 'wave/19-option-c', '--source', 'basson-boerdery'],
      deps,
    );

    expect(code).toBe(0);
    const output = JSON.parse(deps.stdoutLines[0]);
    expect(output.alreadyExisted).toBe(true);
  });
});

// ── destroy ───────────────────────────────────────────────────────────────────

describe('runCli destroy', () => {
  it('happy path: stdout JSON, exit 0', async () => {
    const destroyResult = makeDestroyResult();
    const deps = makeDeps({
      destroyBranchDbImpl: vi.fn().mockResolvedValue(destroyResult),
    });

    const code = await runCli(['destroy', 'wave/19-option-c'], deps);

    expect(code).toBe(0);
    expect(deps.destroyBranchDbImpl).toHaveBeenCalledOnce();
    const callArg = (deps.destroyBranchDbImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as DestroyBranchDbInput;
    expect(callArg.branchName).toBe('wave/19-option-c');
    expect(callArg.skipTursoDestroy).toBe(false);

    expect(deps.stdoutLines).toHaveLength(1);
    const output = JSON.parse(deps.stdoutLines[0]);
    expect(output.branchName).toBe('wave/19-option-c');
    expect(output.tursoDestroyed).toBe(true);
    expect(output.metaRowDeleted).toBe(true);
    expect(deps.stderrLines).toHaveLength(0);
  });

  it('--skip-turso: skipTursoDestroy=true passed to impl', async () => {
    const deps = makeDeps({
      destroyBranchDbImpl: vi.fn().mockResolvedValue(
        makeDestroyResult({ tursoDestroyed: false }),
      ),
    });

    const code = await runCli(['destroy', 'wave/19-option-c', '--skip-turso'], deps);

    expect(code).toBe(0);
    const callArg = (deps.destroyBranchDbImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as DestroyBranchDbInput;
    expect(callArg.skipTursoDestroy).toBe(true);

    const output = JSON.parse(deps.stdoutLines[0]);
    expect(output.tursoDestroyed).toBe(false);
  });

  it('TursoCliError from destroy: stderr + exit 2', async () => {
    const tursoErr = new TursoCliError(
      ['db', 'destroy', 'ft-clone-abc', '--yes'],
      1,
      'DB not found',
    );
    const deps = makeDeps({
      destroyBranchDbImpl: vi.fn().mockRejectedValue(tursoErr),
    });

    const code = await runCli(['destroy', 'wave/19-option-c'], deps);

    expect(code).toBe(2);
    expect(deps.stdoutLines).toHaveLength(0);
    const errOutput = deps.stderrLines.join('\n');
    expect(errOutput).toMatch(/TursoCliError|DB not found/i);
  });

  it('missing branch name: exit 1, impl not called', async () => {
    const deps = makeDeps({
      destroyBranchDbImpl: vi.fn(),
    });

    const code = await runCli(['destroy'], deps);

    expect(code).toBe(1);
    expect(deps.destroyBranchDbImpl).not.toHaveBeenCalled();
  });
});

// ── promote ───────────────────────────────────────────────────────────────────

describe('runCli promote', () => {
  it('happy path with defaults: stdout JSON, exit 0', async () => {
    const promoteResult = makePromoteResult();
    const deps = makeDeps({
      promoteToProdImpl: vi.fn().mockResolvedValue(promoteResult),
    });

    const code = await runCli(['promote', 'wave/19-option-c'], deps);

    expect(code).toBe(0);
    expect(deps.promoteToProdImpl).toHaveBeenCalledOnce();
    const callArg = (deps.promoteToProdImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as PromoteToProdInput;
    expect(callArg.branchName).toBe('wave/19-option-c');
    expect(callArg.forceSkipSoak).toBe(false);
    // minSoakHours not passed → impl uses its own default
    expect(callArg.minSoakHours).toBeUndefined();

    expect(deps.stdoutLines).toHaveLength(1);
    const output = JSON.parse(deps.stdoutLines[0]);
    expect(output.branchName).toBe('wave/19-option-c');
    expect(output.promotedAt).toBe('2026-04-28T10:00:00.000Z');
    expect(output.appliedFiles).toEqual(['0001_init.sql']);
    expect(output.skippedFiles).toEqual([]);
    expect(deps.stderrLines).toHaveLength(0);
  });

  it('--min-soak-hours 2: parsed as number and passed through', async () => {
    const deps = makeDeps({
      promoteToProdImpl: vi.fn().mockResolvedValue(makePromoteResult()),
    });

    const code = await runCli(
      ['promote', 'wave/19-option-c', '--min-soak-hours', '2'],
      deps,
    );

    expect(code).toBe(0);
    const callArg = (deps.promoteToProdImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as PromoteToProdInput;
    expect(callArg.minSoakHours).toBe(2);
  });

  it('--force-skip-soak: parsed and passed through as true', async () => {
    const deps = makeDeps({
      promoteToProdImpl: vi.fn().mockResolvedValue(makePromoteResult()),
    });

    const code = await runCli(
      ['promote', 'wave/19-option-c', '--force-skip-soak'],
      deps,
    );

    expect(code).toBe(0);
    const callArg = (deps.promoteToProdImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as PromoteToProdInput;
    expect(callArg.forceSkipSoak).toBe(true);
  });

  it('SoakNotMetError: stderr has elapsed + threshold, exit 1', async () => {
    const soakErr = new SoakNotMetError('wave/19-option-c', 0.25, 1);
    const deps = makeDeps({
      promoteToProdImpl: vi.fn().mockRejectedValue(soakErr),
    });

    const code = await runCli(['promote', 'wave/19-option-c'], deps);

    expect(code).toBe(1);
    expect(deps.stdoutLines).toHaveLength(0);
    const errOutput = deps.stderrLines.join('\n');
    // Must mention elapsed hours
    expect(errOutput).toMatch(/0\.25|elapsed/i);
    // Must mention the threshold
    expect(errOutput).toMatch(/1\b|required|threshold/i);
  });

  it('BranchCloneNotFoundError: stderr + exit 1', async () => {
    const notFoundErr = new BranchCloneNotFoundError('wave/99-ghost');
    const deps = makeDeps({
      promoteToProdImpl: vi.fn().mockRejectedValue(notFoundErr),
    });

    const code = await runCli(['promote', 'wave/99-ghost'], deps);

    expect(code).toBe(1);
    const errOutput = deps.stderrLines.join('\n');
    expect(errOutput).toMatch(/wave\/99-ghost|not found/i);
  });

  it('unexpected error from promote: stderr + exit 2', async () => {
    const deps = makeDeps({
      promoteToProdImpl: vi.fn().mockRejectedValue(new Error('migration crashed')),
    });

    const code = await runCli(['promote', 'wave/19-option-c'], deps);

    expect(code).toBe(2);
    const errOutput = deps.stderrLines.join('\n');
    expect(errOutput).toMatch(/migration crashed/i);
  });

  it('missing branch name: exit 1, impl not called', async () => {
    const deps = makeDeps({
      promoteToProdImpl: vi.fn(),
    });

    const code = await runCli(['promote'], deps);

    expect(code).toBe(1);
    expect(deps.promoteToProdImpl).not.toHaveBeenCalled();
  });
});

// ── meta ──────────────────────────────────────────────────────────────────────

describe('runCli meta', () => {
  it('--help: prints usage to stdout, exit 0', async () => {
    const deps = makeDeps();

    const code = await runCli(['--help'], deps);

    expect(code).toBe(0);
    const stdoutText = deps.stdoutLines.join('\n');
    expect(stdoutText).toMatch(/usage|clone|destroy|promote/i);
    expect(deps.stderrLines).toHaveLength(0);
  });

  it('no args: prints usage to stdout, exit 0', async () => {
    const deps = makeDeps();

    const code = await runCli([], deps);

    expect(code).toBe(0);
    const stdoutText = deps.stdoutLines.join('\n');
    expect(stdoutText).toMatch(/usage|clone|destroy|promote/i);
    expect(deps.stderrLines).toHaveLength(0);
  });

  it('unknown subcommand: prints message to stderr, exit 1', async () => {
    const deps = makeDeps();

    const code = await runCli(['frobnicate'], deps);

    expect(code).toBe(1);
    const errText = deps.stderrLines.join('\n');
    expect(errText).toMatch(/frobnicate|unknown|--help/i);
  });
});

// ── ci-pass (issue #101) ──────────────────────────────────────────────────────

describe('runCli ci-pass', () => {
  it('happy path: parses argv, calls recordCiPassForCommitImpl, emits JSON, exits 0', async () => {
    const deps = makeDeps({
      recordCiPassForCommitImpl: vi.fn().mockResolvedValue(undefined),
    });

    const code = await runCli(
      ['ci-pass', 'wave/101-soak', '--sha', 'abc123def456'],
      deps,
    );

    expect(code).toBe(0);
    expect(deps.recordCiPassForCommitImpl).toHaveBeenCalledOnce();
    expect(deps.recordCiPassForCommitImpl).toHaveBeenCalledWith(
      expect.objectContaining({ branchName: 'wave/101-soak', commitSha: 'abc123def456' }),
    );

    expect(deps.stdoutLines).toHaveLength(1);
    const output = JSON.parse(deps.stdoutLines[0]);
    expect(output.branchName).toBe('wave/101-soak');
    expect(output.commitSha).toBe('abc123def456');
    expect(output.soakStarted).toBe(true);
    expect(deps.stderrLines).toHaveLength(0);
  });

  it('missing --sha: stderr contains usage, exit 1, impl not called', async () => {
    const deps = makeDeps();

    const code = await runCli(['ci-pass', 'wave/101-soak'], deps);

    expect(code).toBe(1);
    expect(deps.recordCiPassForCommitImpl).not.toHaveBeenCalled();
    const errText = deps.stderrLines.join('\n');
    expect(errText).toMatch(/--sha/i);
  });

  it('missing branch name: stderr contains usage, exit 1', async () => {
    const deps = makeDeps();

    const code = await runCli(['ci-pass', '--sha', 'abc123'], deps);

    expect(code).toBe(1);
    expect(deps.recordCiPassForCommitImpl).not.toHaveBeenCalled();
  });

  it('unexpected error: stderr message, exit 2', async () => {
    const deps = makeDeps({
      recordCiPassForCommitImpl: vi.fn().mockRejectedValue(new Error('DB connection failed')),
    });

    const code = await runCli(
      ['ci-pass', 'wave/101-soak', '--sha', 'abc123'],
      deps,
    );

    expect(code).toBe(2);
    const errText = deps.stderrLines.join('\n');
    expect(errText).toMatch(/DB connection failed/);
  });
});

// ── promote --sha (issue #101) ────────────────────────────────────────────────

describe('runCli promote --sha', () => {
  it('passes headSha to promoteToProdImpl when --sha is provided', async () => {
    const promoteResult = makePromoteResult();
    const deps = makeDeps({
      promoteToProdImpl: vi.fn().mockResolvedValue(promoteResult),
    });

    const code = await runCli(
      ['promote', 'wave/101-soak', '--sha', 'abc123def456'],
      deps,
    );

    expect(code).toBe(0);
    const callArg = (deps.promoteToProdImpl as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as PromoteToProdInput;
    expect(callArg.headSha).toBe('abc123def456');
  });

  it('does not set headSha when --sha is omitted (backward compat)', async () => {
    const promoteResult = makePromoteResult();
    const deps = makeDeps({
      promoteToProdImpl: vi.fn().mockResolvedValue(promoteResult),
    });

    const code = await runCli(['promote', 'wave/101-soak'], deps);

    expect(code).toBe(0);
    const callArg = (deps.promoteToProdImpl as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as PromoteToProdInput;
    expect(callArg.headSha).toBeUndefined();
  });

  it('SoakNotMetError with shaMismatch: stderr contains mismatch message, exit 1', async () => {
    const deps = makeDeps({
      promoteToProdImpl: vi.fn().mockRejectedValue(
        new SoakNotMetError('wave/101-soak', 0, 1, /* shaMismatch */ true),
      ),
    });

    const code = await runCli(
      ['promote', 'wave/101-soak', '--sha', 'new-sha'],
      deps,
    );

    expect(code).toBe(1);
    const errText = deps.stderrLines.join('\n');
    expect(errText).toMatch(/mismatch|re-soak/i);
  });
});
