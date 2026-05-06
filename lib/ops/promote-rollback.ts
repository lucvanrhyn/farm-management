import type { Client } from '@libsql/client';

/**
 * Promote-rollback helper.
 *
 * Established 2026-05-06 after the Phase A "8 admin routes crashed on prod"
 * incident (PRD #128). When the post-promote smoke fails, we want a
 * mechanical, deterministic rollback: clear the meta-DB `promoted_at` row so
 * the branch can be re-promoted after a fix.
 *
 * Deliberately small surface: one function, two queries, one assertion.
 * Tested against an in-memory libSQL with a seeded `branch_db_clones` row.
 */

export interface RollbackOpts {
  /** Meta-DB client. Caller owns lifecycle. */
  metaClient: Client;
  /** Branch name whose promote should be marked rolled-back. */
  branchName: string;
  /** Optional injected clock for tests. */
  now?: () => Date;
}

export interface RollbackResult {
  branchName: string;
  /** ISO timestamp the rollback was recorded. */
  rolledBackAt: string;
  /** Whether a meta-DB row was found + updated. False = no-op (branch unknown). */
  rowUpdated: boolean;
}

/**
 * Clear the `promoted_at` flag on a branch_clones row. Idempotent: if the
 * row doesn't exist (already destroyed) or is already un-promoted, this
 * returns `rowUpdated:false` without throwing.
 *
 * Caller is responsible for posting the failure to the PR and applying the
 * `prod-smoke-failed` label — those need the GH GraphQL API and live in the
 * CLI driver, not here.
 */
export async function rollbackPromote(opts: RollbackOpts): Promise<RollbackResult> {
  const now = opts.now ?? (() => new Date());
  const rolledBackAt = now().toISOString();
  const res = await opts.metaClient.execute({
    sql: `
      UPDATE branch_db_clones
         SET last_promoted_at = NULL,
             prod_migration_at = NULL,
             last_smoke_status = 'rolled_back',
             last_smoke_at = ?
       WHERE branch_name = ?
         AND last_promoted_at IS NOT NULL
    `,
    args: [rolledBackAt, opts.branchName],
  });
  return {
    branchName: opts.branchName,
    rolledBackAt,
    rowUpdated: (res.rowsAffected ?? 0) > 0,
  };
}
