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
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { cloneBranch } from '@/lib/ops/branch-clone';

const execFileAsync = promisify(execFile);

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
  /**
   * Probe for the `turso` binary. Returns the resolved path, or `null` if it
   * isn't on PATH / TURSO_BINARY isn't set. Default reads the env first then
   * shells out to `which turso`. Tests inject a fake.
   *
   * Issue #150: the Vercel build runner does NOT ship the turso CLI, so the
   * default probe must return null there, triggering the installer.
   */
  tursoBinaryProbe?: () => string | null;
  /**
   * Install the turso CLI and return the absolute path to the installed
   * binary. Default mirrors `.github/workflows/governance-gate.yml:37`:
   * `curl -sSfL https://get.tur.so/install.sh | bash`. Tests inject a fake.
   */
  installTursoCli?: () => Promise<string>;
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

  // Default turso-binary probe: prefer TURSO_BINARY env var (already used by
  // lib/ops/turso-cli.ts:41), then `which turso`. Returns null when neither
  // resolves — the trigger for the installer.
  const tursoBinaryProbe =
    deps?.tursoBinaryProbe ??
    (() => {
      const explicit = env.TURSO_BINARY;
      if (explicit && explicit.length > 0) return explicit;
      try {
        // execFileSync isn't injectable here; use the sync `which` via
        // Node's `child_process` only on the default path. Tests always
        // inject this probe so this branch is unreachable from tests.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
        const out = execFileSync('which', ['turso'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        return out.length > 0 ? out : null;
      } catch {
        return null;
      }
    });

  // Default installer: mirrors .github/workflows/governance-gate.yml:37 — runs
  // the official curl install script, then returns the absolute path the
  // installer drops the binary at. Tests always inject this so the real curl
  // never runs from a unit test.
  const installTursoCli =
    deps?.installTursoCli ??
    (async (): Promise<string> => {
      await execFileAsync('bash', ['-c', 'curl -sSfL https://get.tur.so/install.sh | bash'], {
        env: process.env,
      });
      const home = process.env.HOME ?? '/root';
      return `${home}/.turso/turso`;
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

    // Issue #150: Vercel build runner ships without the `turso` CLI, so
    // cloneBranch's execFile('turso', …) crashes with ENOENT. Probe first;
    // if missing, install via the official curl script (matches the GHA
    // gate at .github/workflows/governance-gate.yml:37) and write
    // TURSO_BINARY so lib/ops/turso-cli.ts:41 picks up the installed path.
    if (!tursoBinaryProbe()) {
      let installedAt: string;
      try {
        installedAt = await installTursoCli();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`vercel-prebuild ERROR: turso CLI install failed — ${message}`);
        return 1;
      }
      env.TURSO_BINARY = installedAt;
      log(`vercel-prebuild: turso CLI installed at ${installedAt}`);
    }

    // Issue #220: Turso orgs with >1 DB group require `--group <name>` on
    // `turso db create --from-db`. Thread BRANCH_CLONE_GROUP through;
    // unset = single-group org, no flag emitted.
    const groupName = env.BRANCH_CLONE_GROUP;

    let result;
    try {
      result = await resolvedClone({
        branchName,
        sourceDbName,
        ...(groupName ? { groupName } : {}),
      });
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
