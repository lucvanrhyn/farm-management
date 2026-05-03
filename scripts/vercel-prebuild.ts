#!/usr/bin/env node
/**
 * Vercel prebuild hook for Option C — Turso per-branch DB clone provisioner.
 *
 * Invoked as the first step of the Vercel build command for every deployment.
 * Inspects VERCEL_ENV to decide what to do:
 *
 *   production  → log and exit 0 immediately. NEVER clone, NEVER write env.
 *   preview     → ensure a Turso clone exists for the branch (idempotent),
 *                 then write TURSO_DATABASE_URL + TURSO_AUTH_TOKEN so the rest
 *                 of the build connects to the clone, not prod.
 *   other/none  → log and exit 0. No clone, no env writes.
 *
 * Critical safety property: in production, cloneBranchImpl is NEVER called and
 * writeEnvLine is NEVER called. The test suite verifies this explicitly.
 *
 * Design: all external dependencies are injectable via PrebuildDeps so the
 * function can be unit-tested without real Turso calls, real env vars, or real
 * file I/O.
 */
import fs from 'node:fs';
import { cloneBranch } from '@/lib/ops/branch-clone';

// ── Public types ──────────────────────────────────────────────────────────────

export interface PrebuildDeps {
  /** Injectable impl — defaults to the real cloneBranch. */
  cloneBranchImpl?: typeof cloneBranch;
  /** Injectable env — defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /**
   * Injectable env-line writer. Called once per line in `KEY=value` form.
   * Default: if VERCEL_ENV_FILE is set, append to that file; otherwise
   * write to stdout so the operator can capture it.
   */
  writeEnvLine?: (line: string) => void;
  /** Injectable logger. Defaults to console.log. */
  log?: (line: string) => void;
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Run the prebuild logic. Returns an exit code:
 *   0 — success (or no-op for production/non-preview).
 *   1 — user / configuration error (missing env var, clone failure).
 */
export async function runPrebuild(deps?: PrebuildDeps): Promise<number> {
  const resolvedClone = deps?.cloneBranchImpl ?? cloneBranch;
  const env = deps?.env ?? process.env;
  const log = deps?.log ?? ((line: string) => console.log(line));

  // Default writeEnvLine: append to $VERCEL_ENV_FILE or fall back to stdout
  const writeEnvLine = deps?.writeEnvLine ?? ((line: string) => {
    const envFile = process.env.VERCEL_ENV_FILE;
    if (envFile) {
      fs.appendFileSync(envFile, line + '\n', 'utf8');
    } else {
      console.log(line);
    }
  });

  const vercelEnv = env.VERCEL_ENV;

  // ── Production: enforce required env, then strict no-op ───────────────────
  if (vercelEnv === 'production') {
    // Wave 4 A9 (Codex 2026-05-02 MEDIUM): hard-fail the prod deploy when
    // INNGEST_EVENT_KEY or INNGEST_SIGNING_KEY is missing. Without these the
    // first cron fire silently fails (event sends are 401) and signed-webhook
    // verification rejects every callback — neither symptom obviously points
    // back to the missing env vars. Failing at build time forces the operator
    // to set them in Vercel before the bad deploy ever ships.
    //
    // We collect ALL missing keys in one pass so the operator can fix every
    // gap in one round-trip, not one-per-failed-deploy.
    const missingInngest: string[] = [];
    if (!env.INNGEST_EVENT_KEY) missingInngest.push('INNGEST_EVENT_KEY');
    if (!env.INNGEST_SIGNING_KEY) missingInngest.push('INNGEST_SIGNING_KEY');
    if (missingInngest.length > 0) {
      log(
        `vercel-prebuild ERROR: production deploy missing required Inngest env var(s): ${missingInngest.join(', ')}. ` +
          `Set them in Vercel Project Settings → Environment Variables (Production scope) from the Inngest cloud dashboard, ` +
          `then redeploy. Aborting build to prevent a deploy where cron fires would silently 401 and signed webhooks would reject.`,
      );
      return 1;
    }

    log('vercel-prebuild: production build — using prod TURSO env, skipping clone');
    return 0;
  }

  // ── Preview: provision clone ───────────────────────────────────────────────
  if (vercelEnv === 'preview') {
    const branchName = env.VERCEL_GIT_COMMIT_REF;
    const sourceDbName = env.BRANCH_CLONE_SOURCE_DB;

    if (!branchName) {
      log(
        'vercel-prebuild ERROR: VERCEL_GIT_COMMIT_REF is not set — cannot determine branch name for clone.',
      );
      return 1;
    }

    if (!sourceDbName) {
      log(
        'vercel-prebuild ERROR: BRANCH_CLONE_SOURCE_DB is not set — set it in Vercel project env vars to the source Turso DB name.',
      );
      return 1;
    }

    let result;
    try {
      result = await resolvedClone({ branchName, sourceDbName });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`vercel-prebuild ERROR: clone failed — ${message}`);
      return 1;
    }

    // Write env lines for the rest of the build pipeline
    writeEnvLine(`TURSO_DATABASE_URL=${result.tursoDbUrl}`);
    writeEnvLine(`TURSO_AUTH_TOKEN=${result.tursoAuthToken}`);

    const existedNote = result.alreadyExisted ? ' (already existed)' : '';
    log(
      `vercel-prebuild: preview build — branch=${branchName} cloned to ${result.tursoDbName}${existedNote}, env rewritten`,
    );
    return 0;
  }

  // ── Everything else: no-op ────────────────────────────────────────────────
  log(
    `vercel-prebuild: non-production, non-preview build (VERCEL_ENV=${vercelEnv ?? 'unset'}) — skipping clone`,
  );
  return 0;
}

// ── Module guard ──────────────────────────────────────────────────────────────

(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isCjsMain = typeof require !== 'undefined' && (require as any).main === module;
  const isEsmMain = (() => {
    try {
      const fileUrl = new URL(import.meta.url);
      const argv1 = process.argv[1];
      if (!argv1) return false;
      const argvUrl = new URL(argv1, 'file://');
      return fileUrl.pathname === argvUrl.pathname;
    } catch {
      return false;
    }
  })();

  if (isCjsMain || isEsmMain) {
    const code = await runPrebuild();
    process.exit(code);
  }
})();
