#!/usr/bin/env node
/**
 * CLI entry point for the Option C Turso per-branch DB clone provisioner.
 *
 * Subcommands:
 *   clone <branchName> --source <sourceDbName> [--prefix <prefix>]
 *   destroy <branchName> [--skip-turso]
 *   promote <branchName> [--min-soak-hours <n>] [--force-skip-soak]
 *
 * Designed for testability: all external dependencies (impl functions, I/O,
 * process.exit) are injectable via CliDeps. The module guard at the bottom
 * wires up real defaults when invoked from the command line.
 *
 * Exit codes:
 *   0 — success
 *   1 — user error (missing args, soak not met, clone not found)
 *   2 — unexpected error (TursoCliError, migration failure)
 */
import {
  cloneBranch,
  destroyBranchDb,
  promoteToProd,
  TenantParityFailedError,
  recordCiPassForCommit,
  SoakNotMetError,
  BranchCloneNotFoundError,
} from '@/lib/ops/branch-clone';
import { TursoCliError } from '@/lib/ops/turso-cli';

// ── Public types ──────────────────────────────────────────────────────────────

export interface CliDeps {
  /** Injectable impl — defaults to the real cloneBranch. */
  cloneBranchImpl?: typeof cloneBranch;
  /** Injectable impl — defaults to the real destroyBranchDb. */
  destroyBranchDbImpl?: typeof destroyBranchDb;
  /** Injectable impl — defaults to the real promoteToProd. */
  promoteToProdImpl?: typeof promoteToProd;
  /** Injectable impl — defaults to the real recordCiPassForCommit. */
  recordCiPassForCommitImpl?: typeof recordCiPassForCommit;
  /** Output sink for stdout lines. Defaults to console.log. */
  stdout?: (s: string) => void;
  /** Output sink for stderr lines. Defaults to console.error. */
  stderr?: (s: string) => void;
  /** Process exit. Defaults to process.exit. */
  exit?: (code: number) => void;
}

// ── Usage text ────────────────────────────────────────────────────────────────

const USAGE = `
Usage: branch-clone <command> [options]

Commands:
  clone <branchName> --source <sourceDbName> [--prefix <prefix>] [--group <group>]
      Clone a Turso DB for a branch. Records the clone in the meta-DB.
      Options:
        --source <name>   Source Turso DB name to clone from (required)
        --prefix <prefix> DB name prefix (default: ft-clone)
        --group <name>    Turso DB group to create the clone in (required when org has >1 group)

  destroy <branchName> [--skip-turso]
      Destroy the Turso DB clone and remove the meta-DB record.
      Options:
        --skip-turso      Skip the turso CLI destroy step (meta row only)

  ci-pass <branchName> --sha <commitSha>
      Record that CI passed for a specific commit SHA. Stamps head_sha and
      soak_started_at on the clone row, starting the per-commit soak clock.
      Call this from the CI workflow after all checks pass (issue #101 fix).
      Options:
        --sha <sha>   Commit SHA that passed CI (required)

  promote <branchName> [--sha <headSha>] [--min-soak-hours <n>] [--force-skip-soak] [--escalated-paths-touched <bool>]
      Promote a branch clone to prod by running prod migrations.
      Options:
        --sha <sha>                       PR head commit SHA being promoted (strongly recommended;
                                          required for commit-SHA soak gate, issue #101 fix)
        --min-soak-hours <n>              Minimum soak hours (default: 0.5 — escalated tier per #178)
        --force-skip-soak                 Bypass soak gate (emergency use only)
        --escalated-paths-touched <bool>  Issue #178 conditional soak gate. 'true' enforces the
                                          minSoakHours floor; 'false' skips soak entirely (pure-
                                          transport fast path); omitted is back-compat (enforce).

Options:
  --help    Print this usage text and exit

Examples:
  branch-clone clone wave/19-option-c --source basson-boerdery
  branch-clone ci-pass wave/19-option-c --sha abc123def456
  branch-clone destroy wave/19-option-c
  branch-clone promote wave/19-option-c --sha abc123def456 --min-soak-hours 2
`.trim();

// ── Argv parser ───────────────────────────────────────────────────────────────

/**
 * Minimal positional + flag parser. Returns a plain object with:
 *   positionals: string[]   (non-flag tokens)
 *   flags: Record<string, string | true>  (--key value, --key=value, or --key)
 */
function parseArgv(argv: readonly string[]): {
  positionals: string[];
  flags: Record<string, string | true>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token.startsWith('--')) {
      // Issue #178: support both `--key value` and `--key=value` forms so
      // GitHub Actions step-output interpolations (`--flag=${{...}}`) work
      // without forcing the workflow author to insert a literal space.
      const eqIdx = token.indexOf('=');
      if (eqIdx > 2) {
        const key = token.slice(2, eqIdx);
        const value = token.slice(eqIdx + 1);
        flags[key] = value;
        i += 1;
        continue;
      }
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positionals.push(token);
      i += 1;
    }
  }

  return { positionals, flags };
}

// ── Subcommand handlers ───────────────────────────────────────────────────────

async function handleClone(
  positionals: string[],
  flags: Record<string, string | true>,
  deps: Required<CliDeps>,
): Promise<number> {
  // positionals[0] is 'clone', positionals[1] is branchName
  const branchName = positionals[1];
  const sourceDbName = typeof flags['source'] === 'string' ? flags['source'] : undefined;

  if (!branchName) {
    deps.stderr('Error: branch name is required.\n\n' + USAGE);
    return 1;
  }
  if (!sourceDbName) {
    deps.stderr('Error: --source <sourceDbName> is required.\n\n' + USAGE);
    return 1;
  }

  const cliPrefix = typeof flags['prefix'] === 'string' ? flags['prefix'] : 'ft-clone';
  const groupName = typeof flags['group'] === 'string' ? flags['group'] : undefined;

  try {
    const result = await deps.cloneBranchImpl({
      branchName,
      sourceDbName,
      cliPrefix,
      groupName,
    });

    // Omit tursoAuthToken from output for log safety.
    deps.stdout(JSON.stringify({
      branchName: result.branchName,
      tursoDbName: result.tursoDbName,
      tursoDbUrl: result.tursoDbUrl,
      alreadyExisted: result.alreadyExisted,
    }));
    return 0;
  } catch (err) {
    if (err instanceof TursoCliError) {
      deps.stderr(`TursoCliError: ${err.message}`);
      return 2;
    }
    deps.stderr(`Unexpected error during clone: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

async function handleDestroy(
  positionals: string[],
  flags: Record<string, string | true>,
  deps: Required<CliDeps>,
): Promise<number> {
  // positionals[0] is 'destroy', positionals[1] is branchName
  const branchName = positionals[1];

  if (!branchName) {
    deps.stderr('Error: branch name is required.\n\n' + USAGE);
    return 1;
  }

  const skipTursoDestroy = flags['skip-turso'] === true;

  try {
    const result = await deps.destroyBranchDbImpl({
      branchName,
      skipTursoDestroy,
    });

    deps.stdout(JSON.stringify({
      branchName: result.branchName,
      tursoDestroyed: result.tursoDestroyed,
      metaRowDeleted: result.metaRowDeleted,
    }));
    return 0;
  } catch (err) {
    if (err instanceof TursoCliError) {
      deps.stderr(`TursoCliError: ${err.message}`);
      return 2;
    }
    deps.stderr(`Unexpected error during destroy: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

async function handleCiPass(
  positionals: string[],
  flags: Record<string, string | true>,
  deps: Required<CliDeps>,
): Promise<number> {
  // positionals[0] is 'ci-pass', positionals[1] is branchName
  const branchName = positionals[1];
  const commitSha = typeof flags['sha'] === 'string' ? flags['sha'] : undefined;

  if (!branchName) {
    deps.stderr('Error: branch name is required.\n\n' + USAGE);
    return 1;
  }
  if (!commitSha) {
    deps.stderr('Error: --sha <commitSha> is required.\n\n' + USAGE);
    return 1;
  }

  try {
    await deps.recordCiPassForCommitImpl({ branchName, commitSha });
    deps.stdout(JSON.stringify({ branchName, commitSha, soakStarted: true }));
    return 0;
  } catch (err) {
    deps.stderr(`Unexpected error during ci-pass: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

async function handlePromote(
  positionals: string[],
  flags: Record<string, string | true>,
  deps: Required<CliDeps>,
): Promise<number> {
  // positionals[0] is 'promote', positionals[1] is branchName
  const branchName = positionals[1];

  if (!branchName) {
    deps.stderr('Error: branch name is required.\n\n' + USAGE);
    return 1;
  }

  const forceSkipSoak = flags['force-skip-soak'] === true;
  const minSoakHoursRaw = flags['min-soak-hours'];
  const minSoakHours =
    typeof minSoakHoursRaw === 'string' ? Number(minSoakHoursRaw) : undefined;
  // Issue #101: --sha is strongly recommended so the gate keys on the commit
  // being promoted, not on the branch clone creation time.
  const headSha = typeof flags['sha'] === 'string' ? flags['sha'] : undefined;

  // Issue #178: --escalated-paths-touched accepts 'true'/'false' string
  // (matches GitHub Actions step-output convention). Anything else
  // (including absent) → undefined → back-compat full soak.
  const escalatedRaw = flags['escalated-paths-touched'];
  const escalatedPathsTouched =
    escalatedRaw === 'true' ? true :
    escalatedRaw === 'false' ? false :
    undefined;

  try {
    const result = await deps.promoteToProdImpl({
      branchName,
      headSha,
      forceSkipSoak,
      ...(minSoakHours !== undefined ? { minSoakHours } : {}),
      ...(escalatedPathsTouched !== undefined ? { escalatedPathsTouched } : {}),
    });

    deps.stdout(JSON.stringify({
      branchName: result.branchName,
      promotedAt: result.promotedAt,
      appliedFiles: result.prodMigrationAppliedFiles,
      skippedFiles: result.prodMigrationSkippedFiles,
    }));
    return 0;
  } catch (err) {
    if (err instanceof SoakNotMetError) {
      const msg = err.shaMismatch
        ? `Soak SHA mismatch for branch '${err.branchName}': a new commit was pushed after soak started. Re-soak required.`
        : `Soak gate not met for branch '${err.branchName}': ` +
          `${err.soakHoursElapsed.toFixed(2)}h elapsed of ${err.minSoakHours}h required. ` +
          `Wait or re-run with --force-skip-soak.`;
      deps.stderr(msg);
      return 1;
    }
    if (err instanceof BranchCloneNotFoundError) {
      deps.stderr(`Branch clone not found: '${err.branchName}'. Run 'clone' first.`);
      return 1;
    }
    if (err instanceof TenantParityFailedError) {
      // PRD #128: post-migration parity verifier detected drift. The meta
      // row was NOT marked promoted, so the operator can investigate, fix
      // the failing tenant(s), and re-run the promote. Surface the full
      // formatted report on stderr so the post-merge-promote workflow can
      // paste it into the incident issue.
      deps.stderr(err.formatted);
      return 3;
    }
    if (err instanceof TursoCliError) {
      deps.stderr(`TursoCliError: ${err.message}`);
      return 2;
    }
    deps.stderr(`Unexpected error during promote: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

// ── Main exported function ────────────────────────────────────────────────────

export async function runCli(
  argv: readonly string[],
  deps?: CliDeps,
): Promise<number> {
  // Resolve deps with real defaults
  const resolvedDeps: Required<CliDeps> = {
    cloneBranchImpl: deps?.cloneBranchImpl ?? cloneBranch,
    destroyBranchDbImpl: deps?.destroyBranchDbImpl ?? destroyBranchDb,
    promoteToProdImpl: deps?.promoteToProdImpl ?? promoteToProd,
    recordCiPassForCommitImpl: deps?.recordCiPassForCommitImpl ?? recordCiPassForCommit,
    stdout: deps?.stdout ?? ((s) => console.log(s)),
    stderr: deps?.stderr ?? ((s) => console.error(s)),
    exit: deps?.exit ?? ((code) => process.exit(code)),
  };

  const { positionals, flags } = parseArgv(argv);
  const subcommand = positionals[0];

  // Handle --help and no-args before checking subcommand
  if (!subcommand || flags['help'] === true) {
    resolvedDeps.stdout(USAGE);
    return 0;
  }

  switch (subcommand) {
    case 'clone':
      return handleClone(positionals, flags, resolvedDeps);
    case 'destroy':
      return handleDestroy(positionals, flags, resolvedDeps);
    case 'ci-pass':
      return handleCiPass(positionals, flags, resolvedDeps);
    case 'promote':
      return handlePromote(positionals, flags, resolvedDeps);
    default:
      resolvedDeps.stderr(`Unknown command: '${subcommand}'. Run --help for usage.`);
      return 1;
  }
}

// ── Module guard ──────────────────────────────────────────────────────────────

// Use a try/catch pattern to support both CJS (require.main) and ESM contexts.
// In ESM, `require` is not defined but we still want the bottom guard to work
// when run as `tsx scripts/branch-clone.ts`.
// The `tsx` runner executes this file as a module, so we check import.meta.url
// against the process argv to detect direct invocation.

(async () => {
  // Only run when this file is the direct entry point.
  // Both CJS (require.main === module) and ESM (import.meta check) patterns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isCjsMain = typeof require !== 'undefined' && (require as any).main === module;
  const isEsmMain = (() => {
    try {
      // import.meta.url is only available in ESM. In CJS tsx transpiles this.
      const fileUrl = new URL(import.meta.url);
      const argv1 = process.argv[1];
      if (!argv1) return false;
      // Compare the resolved file path with process.argv[1]
      const argvUrl = new URL(argv1, 'file://');
      return fileUrl.pathname === argvUrl.pathname;
    } catch {
      return false;
    }
  })();

  if (isCjsMain || isEsmMain) {
    const code = await runCli(process.argv.slice(2));
    process.exit(code);
  }
})();
