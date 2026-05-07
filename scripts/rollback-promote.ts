#!/usr/bin/env tsx
/**
 * Promote-rollback CLI.
 *
 * Established by PRD #128 (2026-05-06). Invoked by the post-merge-promote
 * workflow when the post-promote smoke fails. Clears the meta-DB
 * `promoted_at` row so the branch can be re-promoted after a fix.
 *
 * Usage:
 *   pnpm tsx scripts/rollback-promote.ts --branch wave/128-ci-runtime-gates
 *
 * Exit codes:
 *   0 — meta row cleared (or already cleared / not present)
 *   2 — config error (missing META_TURSO_URL etc)
 */
import { getMetaClient } from '../lib/meta-db';
import { rollbackPromote } from '../lib/ops/promote-rollback';

function parseBranch(argv: readonly string[]): string {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--branch' && args[i + 1]) return args[i + 1];
  }
  console.error('rollback-promote: --branch <name> required');
  process.exit(2);
}

async function main(argv: readonly string[]): Promise<number> {
  const branchName = parseBranch(argv);

  if (!process.env.META_TURSO_URL || !process.env.META_TURSO_AUTH_TOKEN) {
    console.error('rollback-promote: META_TURSO_URL / META_TURSO_AUTH_TOKEN required');
    return 2;
  }

  const metaClient = getMetaClient();
  const result = await rollbackPromote({ metaClient, branchName });

  console.log(
    JSON.stringify({
      branchName: result.branchName,
      rolledBackAt: result.rolledBackAt,
      rowUpdated: result.rowUpdated,
    }),
  );
  return 0;
}

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    console.error('rollback-promote: fatal:', err);
    process.exit(2);
  },
);
