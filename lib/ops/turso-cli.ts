/**
 * Thin typed wrapper around the `turso` CLI binary.
 *
 * Designed so callers (branch-clone.ts) can inject a fake TursoCli in tests
 * without touching child_process at all.
 *
 * The real implementation reads two env vars:
 *   TURSO_BINARY     — path to the turso binary (default: 'turso')
 *   TURSO_API_TOKEN  — auth token forwarded in the child's environment
 *                      (turso CLI reads it natively; we do NOT prepend flags)
 */
import { execFile } from 'node:child_process';

// ── Public interface ──────────────────────────────────────────────────────────

export interface TursoCli {
  /**
   * Run a turso CLI subcommand. Returns trimmed stdout.
   * Throws TursoCliError on non-zero exit.
   */
  run(args: readonly string[]): Promise<string>;
}

export class TursoCliError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(
      `turso ${args.join(' ')} failed with exit code ${exitCode ?? 'null'}: ${stderr}`.trimEnd(),
    );
    this.name = 'TursoCliError';
  }
}

// ── Default implementation ────────────────────────────────────────────────────

export const realTursoCli: TursoCli = {
  run(args: readonly string[]): Promise<string> {
    const binary = process.env.TURSO_BINARY ?? 'turso';

    return new Promise((resolve, reject) => {
      execFile(
        binary,
        args as string[],
        {
          // Pass the full environment so TURSO_API_TOKEN (and any other vars
          // the turso binary needs) are visible to the child process.
          env: process.env,
          // Allow reasonable output sizes (tokens can be large).
          maxBuffer: 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new TursoCliError(args, error.code as unknown as number | null, stderr),
            );
            return;
          }
          resolve(stdout.trim());
        },
      );
    });
  },
};
