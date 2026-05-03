// @vitest-environment node
/**
 * Tests for scripts/vercel-prebuild.ts — the Vercel prebuild hook that
 * provisions a Turso DB clone for preview deployments.
 *
 * All tests use the exported `runPrebuild(deps)` function with injected fakes
 * for cloneBranchImpl, env, writeEnvLine, and log. No real Turso binary or
 * network calls are made.
 *
 * Test plan:
 *   production safety (CRITICAL)
 *     1. VERCEL_ENV=production → cloneBranchImpl NOT called, writeEnvLine NOT called, exit 0
 *   preview happy path
 *     2. VERCEL_ENV=preview + valid branch + source → cloneBranchImpl called with correct args,
 *        two env lines written (URL + token), exit 0
 *   preview error paths
 *     3. Preview without BRANCH_CLONE_SOURCE_DB → error logged, exit 1, no clone, no env writes
 *     4. Preview without VERCEL_GIT_COMMIT_REF → error logged, exit 1, no clone, no env writes
 *   idempotent clone
 *     5. cloneBranchImpl returns alreadyExisted=true → still writes env lines, logs "already", exit 0
 *   development / unknown env
 *     6. VERCEL_ENV=development → no clone, no env writes, exit 0
 *     7. No VERCEL_ENV at all → no clone, no env writes, exit 0
 *   clone failure
 *     8. cloneBranchImpl throws → error logged, exit 1, no env writes
 */

import { describe, it, expect, vi } from 'vitest';
import { runPrebuild, type PrebuildDeps } from '@/scripts/vercel-prebuild';
import type { CloneBranchResult } from '@/lib/ops/branch-clone';

// ── Fake builders ─────────────────────────────────────────────────────────────

function makeCloneResult(overrides?: Partial<CloneBranchResult>): CloneBranchResult {
  return {
    branchName: 'wave/19-option-c',
    tursoDbName: 'ft-clone-wave-19-option-c-abc123',
    tursoDbUrl: 'libsql://ft-clone-wave-19-option-c-abc123.turso.io',
    tursoAuthToken: 'preview-secret-token',
    alreadyExisted: false,
    ...overrides,
  };
}

function makeDeps(
  envOverrides: Record<string, string | undefined> = {},
  depOverrides?: Partial<PrebuildDeps>,
): PrebuildDeps & { envLines: string[]; logLines: string[] } {
  const envLines: string[] = [];
  const logLines: string[] = [];

  return {
    cloneBranchImpl: vi.fn(),
    env: {
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_REF: undefined,
      BRANCH_CLONE_SOURCE_DB: undefined,
      VERCEL_ENV_FILE: undefined,
      ...envOverrides,
    } as unknown as NodeJS.ProcessEnv,
    writeEnvLine: (line: string) => envLines.push(line),
    log: (line: string) => logLines.push(line),
    envLines,
    logLines,
    ...depOverrides,
  };
}

// ── production safety (CRITICAL) ─────────────────────────────────────────────

describe('production safety', () => {
  it('VERCEL_ENV=production: cloneBranchImpl NOT called, writeEnvLine NOT called, returns 0', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'main',
      BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
      // Wave 4 A9: production now requires the Inngest keys to be set; without
      // them the prebuild hard-fails (exit 1). Provide them here so this test
      // still asserts what it's named for — production NEVER clones / NEVER
      // writes env lines. The Inngest gate itself is covered in
      // scripts/__tests__/vercel-prebuild-inngest-gate.test.ts.
      INNGEST_EVENT_KEY: 'event-key-secret-xxx',
      INNGEST_SIGNING_KEY: 'signing-key-secret-yyy',
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);
    // Must log a message explaining the skip
    const allLogs = deps.logLines.join('\n');
    expect(allLogs).toMatch(/production/i);
  });
});

// ── preview happy path ────────────────────────────────────────────────────────

describe('preview happy path', () => {
  it('preview + valid branch + source → cloneBranchImpl called, two env lines written, returns 0', async () => {
    const cloneResult = makeCloneResult();
    const deps = makeDeps(
      {
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'wave/19-option-c',
        BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
      },
      {
        cloneBranchImpl: vi.fn().mockResolvedValue(cloneResult),
      },
    );

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(deps.cloneBranchImpl).toHaveBeenCalledOnce();

    // Verify the call args
    const callArg = (deps.cloneBranchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.branchName).toBe('wave/19-option-c');
    expect(callArg.sourceDbName).toBe('basson-boerdery');

    // Exactly two env lines: URL and token
    expect(deps.envLines).toHaveLength(2);
    const urlLine = deps.envLines.find((l) => l.startsWith('TURSO_DATABASE_URL='));
    const tokenLine = deps.envLines.find((l) => l.startsWith('TURSO_AUTH_TOKEN='));
    expect(urlLine).toBe(`TURSO_DATABASE_URL=${cloneResult.tursoDbUrl}`);
    expect(tokenLine).toBe(`TURSO_AUTH_TOKEN=${cloneResult.tursoAuthToken}`);

    // Log should mention branch and clone details
    const allLogs = deps.logLines.join('\n');
    expect(allLogs).toMatch(/preview/i);
    expect(allLogs).toMatch(/wave\/19-option-c/);
  });
});

// ── preview error paths ───────────────────────────────────────────────────────

describe('preview error paths', () => {
  it('preview without BRANCH_CLONE_SOURCE_DB → error logged, returns 1, no clone, no env writes', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'wave/19-option-c',
      BRANCH_CLONE_SOURCE_DB: undefined,
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(1);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);

    const allLogs = deps.logLines.join('\n');
    expect(allLogs).toMatch(/BRANCH_CLONE_SOURCE_DB/i);
  });

  it('preview without VERCEL_GIT_COMMIT_REF → error logged, returns 1, no clone, no env writes', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: undefined,
      BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(1);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);

    const allLogs = deps.logLines.join('\n');
    expect(allLogs).toMatch(/VERCEL_GIT_COMMIT_REF/i);
  });

  it('preview with empty VERCEL_GIT_COMMIT_REF → error logged, returns 1, no clone, no env writes', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: '',
      BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(1);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);
  });
});

// ── idempotent clone ──────────────────────────────────────────────────────────

describe('idempotent clone', () => {
  it('cloneBranchImpl returns alreadyExisted=true → still writes env lines, logs "already", returns 0', async () => {
    const cloneResult = makeCloneResult({ alreadyExisted: true });
    const deps = makeDeps(
      {
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'wave/19-option-c',
        BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
      },
      {
        cloneBranchImpl: vi.fn().mockResolvedValue(cloneResult),
      },
    );

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    // Env lines must still be written even when the clone already existed
    expect(deps.envLines).toHaveLength(2);
    const urlLine = deps.envLines.find((l) => l.startsWith('TURSO_DATABASE_URL='));
    expect(urlLine).toBe(`TURSO_DATABASE_URL=${cloneResult.tursoDbUrl}`);

    const allLogs = deps.logLines.join('\n');
    expect(allLogs).toMatch(/already/i);
  });
});

// ── development / unknown env ─────────────────────────────────────────────────

describe('non-preview non-production environments', () => {
  it('VERCEL_ENV=development → no clone, no env writes, returns 0', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'development',
      VERCEL_GIT_COMMIT_REF: 'my-feature',
      BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);

    const allLogs = deps.logLines.join('\n');
    // Should log something explaining the skip
    expect(allLogs).toMatch(/skip|non-production|non-preview/i);
  });

  it('no VERCEL_ENV at all → no clone, no env writes, returns 0', async () => {
    const deps = makeDeps({
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_REF: 'wave/19-option-c',
      BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);
  });
});

// ── clone failure ─────────────────────────────────────────────────────────────

describe('clone failure', () => {
  it('cloneBranchImpl throws → error logged, returns 1, no env writes (build must not succeed against prod creds)', async () => {
    const deps = makeDeps(
      {
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'wave/19-option-c',
        BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
      },
      {
        cloneBranchImpl: vi.fn().mockRejectedValue(new Error('turso network timeout')),
      },
    );

    const code = await runPrebuild(deps);

    expect(code).toBe(1);
    // Critical: no env lines must have been written
    expect(deps.envLines).toHaveLength(0);

    const allLogs = deps.logLines.join('\n');
    expect(allLogs).toMatch(/turso network timeout/i);
  });
});
