// @vitest-environment node
/**
 * Tests for the Turso CLI install logic in scripts/vercel-prebuild.ts.
 *
 * Covers issue #150 — the Vercel build runner does not ship the `turso` binary,
 * so every preview deploy fails at the cloneBranch step with ENOENT. The fix
 * mirrors what `.github/workflows/governance-gate.yml:37` already does on the
 * GHA runner: probe for the binary, install via the official curl script when
 * missing, then set TURSO_BINARY so the rest of the build picks up the
 * installed path (`lib/ops/turso-cli.ts:41` already reads this env var).
 *
 * Test plan:
 *   preview, binary missing → installer invoked once, TURSO_BINARY set, cloneBranchImpl called, exit 0
 *   preview, binary already on PATH → installer NOT invoked, cloneBranchImpl still called, exit 0
 *   preview, installer throws → exit 1, error logged with installer message, no env lines written
 *   production → installer NEVER invoked even when probe says missing (strict no-op)
 *   non-preview/non-production (development) → installer NOT invoked
 */

import { describe, it, expect, vi } from 'vitest';
import { runPrebuild, type PrebuildDeps } from '@/scripts/vercel-prebuild';
import type { CloneBranchResult } from '@/lib/ops/branch-clone';

// ── Fake builders ─────────────────────────────────────────────────────────────

function makeCloneResult(overrides?: Partial<CloneBranchResult>): CloneBranchResult {
  return {
    branchName: 'wave/150-vercel-prebuild-turso',
    tursoDbName: 'ft-clone-wave-150-vercel-prebuild-turso-abc123',
    tursoDbUrl: 'libsql://ft-clone-wave-150-vercel-prebuild-turso-abc123.turso.io',
    tursoAuthToken: 'preview-secret-token',
    alreadyExisted: false,
    ...overrides,
  };
}

interface InstallTestDeps extends PrebuildDeps {
  envLines: string[];
  logLines: string[];
  installerCalls: number;
  envSnapshot: NodeJS.ProcessEnv;
}

function makeDeps(
  envOverrides: Record<string, string | undefined> = {},
  depOverrides?: Partial<PrebuildDeps> & {
    tursoBinaryProbe?: () => string | null;
    installTursoCli?: () => Promise<string>;
  },
): InstallTestDeps {
  const envLines: string[] = [];
  const logLines: string[] = [];
  // Use a real process-env-shaped object so the SUT can mutate it via assignment.
  const envSnapshot: NodeJS.ProcessEnv = {
    VERCEL_ENV: undefined,
    VERCEL_GIT_COMMIT_REF: undefined,
    BRANCH_CLONE_SOURCE_DB: undefined,
    VERCEL_ENV_FILE: undefined,
    TURSO_BINARY: undefined,
    ...envOverrides,
  } as unknown as NodeJS.ProcessEnv;

  let installerCalls = 0;

  const baseDeps: PrebuildDeps & {
    tursoBinaryProbe?: () => string | null;
    installTursoCli?: () => Promise<string>;
  } = {
    cloneBranchImpl: vi.fn().mockResolvedValue(makeCloneResult()),
    env: envSnapshot,
    writeEnvLine: (line: string) => envLines.push(line),
    log: (line: string) => logLines.push(line),
    // Default: probe says binary is missing (so installer runs by default in
    // preview happy path tests). Tests that exercise the "already present"
    // branch override this.
    tursoBinaryProbe: () => null,
    installTursoCli: async () => {
      installerCalls += 1;
      return '/home/runner/.turso/turso';
    },
    ...depOverrides,
  };

  // Wrap installer so the call count is accurate even when test overrides it.
  const wrappedInstaller =
    depOverrides?.installTursoCli !== undefined
      ? async () => {
          installerCalls += 1;
          return depOverrides.installTursoCli!();
        }
      : baseDeps.installTursoCli;

  return {
    ...baseDeps,
    installTursoCli: wrappedInstaller,
    envLines,
    logLines,
    envSnapshot,
    get installerCalls() {
      return installerCalls;
    },
  } as InstallTestDeps;
}

// ── preview, binary missing → installer fires ────────────────────────────────

describe('preview Turso CLI install — binary missing', () => {
  it('installer invoked once, TURSO_BINARY set in env passed to cloneBranchImpl, returns 0', async () => {
    const cloneResult = makeCloneResult();
    const cloneSpy = vi.fn().mockResolvedValue(cloneResult);

    const deps = makeDeps(
      {
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'wave/150-vercel-prebuild-turso',
        BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
      },
      {
        cloneBranchImpl: cloneSpy,
        tursoBinaryProbe: () => null, // not on PATH
        installTursoCli: vi.fn().mockResolvedValue('/home/runner/.turso/turso'),
      },
    );

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(deps.installerCalls).toBe(1);
    // After install, TURSO_BINARY must be set on the env so turso-cli.ts:41 picks it up
    expect(deps.envSnapshot.TURSO_BINARY).toBe('/home/runner/.turso/turso');
    expect(cloneSpy).toHaveBeenCalledOnce();
    expect(deps.envLines).toHaveLength(2);

    const allLogs = deps.logLines.join('\n');
    // Should log that we installed the CLI
    expect(allLogs).toMatch(/install|turso/i);
  });
});

// ── preview, binary already present → installer skipped ──────────────────────

describe('preview Turso CLI install — binary already present', () => {
  it('installer NOT invoked, cloneBranchImpl still called, returns 0', async () => {
    const cloneResult = makeCloneResult();
    const cloneSpy = vi.fn().mockResolvedValue(cloneResult);

    const deps = makeDeps(
      {
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'wave/150-vercel-prebuild-turso',
        BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
      },
      {
        cloneBranchImpl: cloneSpy,
        tursoBinaryProbe: () => '/usr/local/bin/turso', // already on PATH
        installTursoCli: vi.fn(),
      },
    );

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(deps.installerCalls).toBe(0);
    expect(cloneSpy).toHaveBeenCalledOnce();
  });
});

// ── preview, installer throws → exit 1 ───────────────────────────────────────

describe('preview Turso CLI install — installer failure', () => {
  it('installer throws → exit 1, error logged with installer message, no env writes, no clone', async () => {
    const cloneSpy = vi.fn();
    const deps = makeDeps(
      {
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'wave/150-vercel-prebuild-turso',
        BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
      },
      {
        cloneBranchImpl: cloneSpy,
        tursoBinaryProbe: () => null,
        installTursoCli: vi.fn().mockRejectedValue(new Error('curl 503: get.tur.so unreachable')),
      },
    );

    const code = await runPrebuild(deps);

    expect(code).toBe(1);
    expect(cloneSpy).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);

    const allLogs = deps.logLines.join('\n');
    expect(allLogs).toMatch(/install/i);
    expect(allLogs).toMatch(/curl 503: get\.tur\.so unreachable/);
  });
});

// ── production → installer never runs (strict no-op) ─────────────────────────

describe('production safety — installer is strict no-op', () => {
  it('VERCEL_ENV=production with probe=null still does NOT invoke installer, returns 0', async () => {
    const installerSpy = vi.fn().mockResolvedValue('/should/not/be/called');
    const deps = makeDeps(
      {
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_REF: 'main',
        BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
        // Wave 4 A9 production gate requires these — see vercel-prebuild.test.ts for context
        INNGEST_EVENT_KEY: 'event-key-secret-xxx',
        INNGEST_SIGNING_KEY: 'signing-key-secret-yyy',
      },
      {
        tursoBinaryProbe: () => null, // says binary missing
        installTursoCli: installerSpy,
      },
    );

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(installerSpy).not.toHaveBeenCalled();
    expect(deps.installerCalls).toBe(0);
    expect(deps.envSnapshot.TURSO_BINARY).toBeUndefined();
  });
});

// ── non-preview, non-production → installer never runs ───────────────────────

describe('non-preview non-production — installer never runs', () => {
  it('VERCEL_ENV=development → installer NOT invoked', async () => {
    const installerSpy = vi.fn().mockResolvedValue('/should/not/be/called');
    const deps = makeDeps(
      {
        VERCEL_ENV: 'development',
        VERCEL_GIT_COMMIT_REF: 'my-feature',
        BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
      },
      {
        tursoBinaryProbe: () => null,
        installTursoCli: installerSpy,
      },
    );

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(installerSpy).not.toHaveBeenCalled();
    expect(deps.installerCalls).toBe(0);
  });

  it('VERCEL_ENV unset → installer NOT invoked', async () => {
    const installerSpy = vi.fn().mockResolvedValue('/should/not/be/called');
    const deps = makeDeps(
      {
        VERCEL_ENV: undefined,
        VERCEL_GIT_COMMIT_REF: 'wave/150-vercel-prebuild-turso',
        BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
      },
      {
        tursoBinaryProbe: () => null,
        installTursoCli: installerSpy,
      },
    );

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(installerSpy).not.toHaveBeenCalled();
    expect(deps.installerCalls).toBe(0);
  });
});
