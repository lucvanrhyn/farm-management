// @vitest-environment node
/**
 * Wave 4 A9 — Inngest missing-keys deploy gate.
 *
 * Tests that `scripts/vercel-prebuild.ts` HARD-FAILS the production build
 * when either `INNGEST_EVENT_KEY` or `INNGEST_SIGNING_KEY` is missing. The
 * existing Codex MEDIUM finding (2026-05-02) is that today the missing keys
 * only `logger.error` from `lib/server/inngest/client.ts` and the deploy
 * succeeds — the first cron fire then silently fails. We move the gate to
 * the prebuild so a misconfigured prod deploy aborts at build time with a
 * clear message naming both keys.
 *
 * Preview / local builds remain unaffected (Inngest is allowed to be missing
 * outside production — local dev hits the Inngest dev server at
 * 127.0.0.1:8288, preview deploys typically don't fire crons).
 *
 * All tests use the exported `runPrebuild(deps)` function with injected
 * fakes for `env` and `log`. No real Turso / network calls are made.
 *
 * Test plan:
 *   1. production with both Inngest keys present → exit 0 (gate passes through to existing prod no-op)
 *   2. production missing INNGEST_EVENT_KEY → exit 1, log names INNGEST_EVENT_KEY
 *   3. production missing INNGEST_SIGNING_KEY → exit 1, log names INNGEST_SIGNING_KEY
 *   4. production missing BOTH keys → exit 1, log names BOTH keys
 *   5. preview missing both keys → exit 0 (preview is allowed to skip Inngest;
 *      we don't want to block PR previews on cloud Inngest creds)
 *   6. no VERCEL_ENV (local build) → exit 0 (local is allowed to skip Inngest)
 */

import { describe, it, expect, vi } from 'vitest';
import { runPrebuild, type PrebuildDeps } from '../vercel-prebuild';

// ── Fake builders ─────────────────────────────────────────────────────────────

function makeDeps(
  envOverrides: Record<string, string | undefined> = {},
  depOverrides?: Partial<PrebuildDeps>,
): PrebuildDeps & { envLines: string[]; logLines: string[] } {
  const envLines: string[] = [];
  const logLines: string[] = [];

  return {
    // Default cloneBranchImpl is a spy — production / local paths must NEVER
    // call it. The preview path test that needs a real-shaped result provides
    // its own override.
    cloneBranchImpl: vi.fn(),
    env: {
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_REF: undefined,
      BRANCH_CLONE_SOURCE_DB: undefined,
      VERCEL_ENV_FILE: undefined,
      INNGEST_EVENT_KEY: undefined,
      INNGEST_SIGNING_KEY: undefined,
      ...envOverrides,
    } as unknown as NodeJS.ProcessEnv,
    writeEnvLine: (line: string) => envLines.push(line),
    log: (line: string) => logLines.push(line),
    envLines,
    logLines,
    ...depOverrides,
  };
}

// ── Production: gate enforces Inngest keys ────────────────────────────────────

describe('Wave 4 A9 — production Inngest deploy gate', () => {
  it('production with BOTH Inngest keys present → exit 0 (gate passes)', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'production',
      INNGEST_EVENT_KEY: 'event-key-secret-xxx',
      INNGEST_SIGNING_KEY: 'signing-key-secret-yyy',
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    // Production is still a no-op for cloning — gate must not call it.
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);
  });

  it('production MISSING INNGEST_EVENT_KEY → exit 1, log names INNGEST_EVENT_KEY', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'production',
      INNGEST_EVENT_KEY: undefined,
      INNGEST_SIGNING_KEY: 'signing-key-secret-yyy',
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(1);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);

    const allLogs = deps.logLines.join('\n');
    expect(allLogs).toMatch(/INNGEST_EVENT_KEY/);
    // Should be flagged as a build-blocking error, not an info message.
    expect(allLogs).toMatch(/error|missing|abort|fail/i);
  });

  it('production MISSING INNGEST_SIGNING_KEY → exit 1, log names INNGEST_SIGNING_KEY', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'production',
      INNGEST_EVENT_KEY: 'event-key-secret-xxx',
      INNGEST_SIGNING_KEY: undefined,
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(1);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);

    const allLogs = deps.logLines.join('\n');
    expect(allLogs).toMatch(/INNGEST_SIGNING_KEY/);
    expect(allLogs).toMatch(/error|missing|abort|fail/i);
  });

  it('production MISSING BOTH keys → exit 1, log names BOTH keys (operator gets one shot to see all gaps)', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'production',
      INNGEST_EVENT_KEY: undefined,
      INNGEST_SIGNING_KEY: undefined,
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(1);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
    expect(deps.envLines).toHaveLength(0);

    const allLogs = deps.logLines.join('\n');
    // Must mention BOTH so the operator fixes both in one round-trip — not one
    // per failed deploy.
    expect(allLogs).toMatch(/INNGEST_EVENT_KEY/);
    expect(allLogs).toMatch(/INNGEST_SIGNING_KEY/);
  });

  it('production with empty-string Inngest key → exit 1 (treat empty same as missing)', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'production',
      INNGEST_EVENT_KEY: '',
      INNGEST_SIGNING_KEY: 'signing-key-secret-yyy',
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(1);
    const allLogs = deps.logLines.join('\n');
    expect(allLogs).toMatch(/INNGEST_EVENT_KEY/);
  });
});

// ── Non-production envs: gate must NOT block ──────────────────────────────────

describe('Wave 4 A9 — non-production paths skip the Inngest gate', () => {
  it('preview missing BOTH Inngest keys → exit 0 (preview is allowed to skip Inngest)', async () => {
    const cloneResult = {
      branchName: 'wave/4-inngest-deploy-gate',
      tursoDbName: 'ft-clone-wave-4-inngest-deploy-gate-abc',
      tursoDbUrl: 'libsql://ft-clone-wave-4-inngest-deploy-gate-abc.turso.io',
      tursoAuthToken: 'preview-secret-token',
      alreadyExisted: false,
    };
    const deps = makeDeps(
      {
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'wave/4-inngest-deploy-gate',
        BRANCH_CLONE_SOURCE_DB: 'basson-boerdery',
        INNGEST_EVENT_KEY: undefined,
        INNGEST_SIGNING_KEY: undefined,
      },
      {
        cloneBranchImpl: vi.fn().mockResolvedValue(cloneResult),
      },
    );

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    // Preview path should still proceed to clone — gate doesn't intercept it.
    expect(deps.cloneBranchImpl).toHaveBeenCalledOnce();
  });

  it('no VERCEL_ENV (local build) → exit 0 even with both Inngest keys missing', async () => {
    const deps = makeDeps({
      VERCEL_ENV: undefined,
      INNGEST_EVENT_KEY: undefined,
      INNGEST_SIGNING_KEY: undefined,
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
  });

  it('VERCEL_ENV=development → exit 0 even with both Inngest keys missing', async () => {
    const deps = makeDeps({
      VERCEL_ENV: 'development',
      INNGEST_EVENT_KEY: undefined,
      INNGEST_SIGNING_KEY: undefined,
    });

    const code = await runPrebuild(deps);

    expect(code).toBe(0);
    expect(deps.cloneBranchImpl).not.toHaveBeenCalled();
  });
});
