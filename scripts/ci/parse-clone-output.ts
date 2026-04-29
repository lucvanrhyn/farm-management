#!/usr/bin/env node
/**
 * scripts/ci/parse-clone-output.ts
 *
 * Reads the JSON emitted by `pnpm ops:clone-branch` from stdin and writes
 * GITHUB_ENV-compatible lines to stdout:
 *
 *   TURSO_DATABASE_URL=<tursoDbUrl>
 *   TURSO_AUTH_TOKEN=<tursoAuthToken>
 *
 * Usage in CI:
 *   cat clone-output.json | tsx scripts/ci/parse-clone-output.ts >> $GITHUB_ENV
 *
 * Exit codes:
 *   0 — success
 *   1 — missing required field or invalid JSON
 *
 * Dependencies: none beyond node:process (dependency-free by design).
 */

// ── Pure parsing function (tested directly) ──────────────────────────────────

/**
 * Parses the JSON string produced by `ops:clone-branch` and returns two
 * GITHUB_ENV-formatted lines.
 *
 * Throws with a descriptive message if:
 *   - input is not valid JSON
 *   - `tursoDbUrl` is missing or not a non-empty string
 *   - `tursoAuthToken` is missing or not a non-empty string
 *
 * Extra fields (branchName, tursoDbName, alreadyExisted, etc.) are ignored.
 */
export function parseCloneOutput(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`parse-clone-output: input is not valid JSON.\nReceived: ${raw.slice(0, 200)}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('parse-clone-output: expected a JSON object at the top level.');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['tursoDbUrl'] !== 'string' || obj['tursoDbUrl'].length === 0) {
    throw new Error(
      'parse-clone-output: missing or empty field "tursoDbUrl" in clone output JSON. ' +
      'Ensure the clone step succeeded and printed valid JSON.',
    );
  }

  if (typeof obj['tursoAuthToken'] !== 'string' || obj['tursoAuthToken'].length === 0) {
    throw new Error(
      'parse-clone-output: missing or empty field "tursoAuthToken" in clone output JSON. ' +
      'Ensure the clone step succeeded and printed valid JSON.',
    );
  }

  return (
    `TURSO_DATABASE_URL=${obj['tursoDbUrl']}\n` +
    `TURSO_AUTH_TOKEN=${obj['tursoAuthToken']}`
  );
}

// ── CLI entry point ──────────────────────────────────────────────────────────

// Only runs when invoked directly (tsx scripts/ci/parse-clone-output.ts).
const isCjsMain =
  typeof require !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (require as any).main === module;

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
  const chunks: Buffer[] = [];
  process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    try {
      const output = parseCloneOutput(raw);
      process.stdout.write(output + '\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(
        (err instanceof Error ? err.message : String(err)) + '\n',
      );
      process.exit(1);
    }
  });
}
