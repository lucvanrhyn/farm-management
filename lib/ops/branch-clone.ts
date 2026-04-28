/**
 * Clone provisioner for Option C (Turso per-branch DB clone).
 *
 * Wraps the Turso CLI to create a DB clone from a source DB, capture its URL
 * and auth token, and record everything in the meta-DB via Phase 1 helpers.
 *
 * Design goals:
 * - Idempotent: returns the existing row immediately without CLI calls.
 * - Hermetically testable: all external dependencies (CLI, meta-DB, clock)
 *   are injectable via the CloneBranchInput.
 * - Atomic: if any CLI step fails, meta-DB is NOT written (no partial record).
 */
import { createHash } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { TursoCli } from '@/lib/ops/turso-cli';
import { realTursoCli } from '@/lib/ops/turso-cli';
import { getMetaClient } from '@/lib/meta-db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CloneBranchInput {
  /** Git branch name, e.g. 'wave/19-option-c'. */
  branchName: string;
  /** Source Turso DB to clone from, e.g. 'basson-boerdery'. */
  sourceDbName: string;
  /** Prefix for the clone DB name. Defaults to 'ft-clone'. */
  cliPrefix?: string;
  /** Injectable CLI runner. Defaults to the real turso binary. */
  cli?: TursoCli;
  /** Injectable meta-DB client. Defaults to the production singleton. */
  metaClient?: Client;
  /** Injectable clock. Defaults to () => new Date(). */
  now?: () => Date;
}

export interface CloneBranchResult {
  branchName: string;
  tursoDbName: string;
  tursoDbUrl: string;
  tursoAuthToken: string;
  /** true if the record was already present — no CLI calls were made. */
  alreadyExisted: boolean;
}

// ── Slug helpers ──────────────────────────────────────────────────────────────

const MAX_TURSO_NAME_LENGTH = 64;

/**
 * Derive a stable, valid Turso DB name from a branch name.
 *
 * Rules:
 * 1. Lowercase.
 * 2. Non-alphanumeric chars → '-'.
 * 3. Collapse consecutive dashes to one.
 * 4. Trim leading/trailing dashes.
 * 5. Append '-' + 6-char hex hash of the *original* branch name so:
 *    - Different branch names never collide.
 *    - Same branch name always produces the same slug.
 * 6. Cap total length at 64 characters (Turso limit). When truncating, keep
 *    the hash suffix intact (trim the slug body, not the hash).
 *
 * Exported so tests can assert slugging logic independently.
 */
export function slugifyBranchName(branchName: string, prefix: string): string {
  // 6-char hex hash of the branch name (deterministic, collision-resistant)
  const hash = createHash('sha1')
    .update(branchName)
    .digest('hex')
    .slice(0, 6);

  const slug = branchName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  // suffix = '-' + hash (7 chars)
  const suffix = `-${hash}`;

  // Maximum body length = limit - prefix.length - 1 (separator) - suffix.length
  // full name = prefix + '-' + body + suffix
  const separatorLen = 1;
  const bodyMaxLen =
    MAX_TURSO_NAME_LENGTH - prefix.length - separatorLen - suffix.length;

  const body = slug.slice(0, bodyMaxLen);

  return `${prefix}-${body}${suffix}`;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function cloneBranch(
  input: CloneBranchInput,
): Promise<CloneBranchResult> {
  const {
    branchName,
    sourceDbName,
    cliPrefix = 'ft-clone',
    cli = realTursoCli,
    now = () => new Date(),
  } = input;

  // Resolve the meta client — prefer the injectable one, fall back to the
  // production singleton (getMetaClient() is synchronous).
  const metaClient: Client = input.metaClient ?? getMetaClient();

  // ── 1. Idempotency check ─────────────────────────────────────────────────
  // We call getBranchClone directly with our chosen client by temporarily
  // swapping the singleton. This avoids duplicating the SQL here.
  //
  // A cleaner approach: call the helper via its client-accepting internal form.
  // Since Phase 1 only exports the singleton-based form, we inject here.
  const existing = await _getBranchCloneViaClient(metaClient, branchName);
  if (existing) {
    return {
      branchName: existing.branchName,
      tursoDbName: existing.tursoDbName,
      tursoDbUrl: existing.tursoDbUrl,
      tursoAuthToken: existing.tursoAuthToken,
      alreadyExisted: true,
    };
  }

  // ── 2. Derive clone DB name ───────────────────────────────────────────────
  const tursoDbName = slugifyBranchName(branchName, cliPrefix);

  // ── 3. Invoke turso CLI (three steps, abort on any failure) ──────────────
  //    a. Create the clone
  await cli.run(['db', 'create', tursoDbName, '--from-db', sourceDbName]);

  //    b. Retrieve the libsql URL
  const tursoDbUrl = await cli.run(['db', 'show', tursoDbName, '--url']);

  //    c. Create a non-expiring auth token
  const tursoAuthToken = await cli.run([
    'db',
    'tokens',
    'create',
    tursoDbName,
    '--expiration',
    'none',
  ]);

  // ── 4. Persist to meta-DB ─────────────────────────────────────────────────
  // We use a local helper that accepts the injected client so the record goes
  // to the in-memory DB in tests instead of the production singleton.
  const createdAt = now().toISOString();
  await _recordBranchCloneViaClient(metaClient, {
    branchName,
    tursoDbName,
    tursoDbUrl,
    tursoAuthToken,
    sourceDbName,
    createdAt,
  });

  // ── 5. Return ─────────────────────────────────────────────────────────────
  return {
    branchName,
    tursoDbName,
    tursoDbUrl,
    tursoAuthToken,
    alreadyExisted: false,
  };
}

// ── Internal client-accepting helpers ─────────────────────────────────────────
// These duplicate the SQL from Phase 1 helpers so we can use the injected
// client instead of the singleton. This avoids side-effects from swapping the
// singleton and keeps tests hermetic.

async function _getBranchCloneViaClient(
  client: Client,
  branchName: string,
): Promise<{
  branchName: string;
  tursoDbName: string;
  tursoDbUrl: string;
  tursoAuthToken: string;
} | null> {
  const result = await client.execute({
    sql: `SELECT branch_name, turso_db_name, turso_db_url, turso_auth_token
          FROM branch_db_clones
          WHERE branch_name = ?
          LIMIT 1`,
    args: [branchName],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    branchName: row.branch_name as string,
    tursoDbName: row.turso_db_name as string,
    tursoDbUrl: row.turso_db_url as string,
    tursoAuthToken: row.turso_auth_token as string,
  };
}

async function _recordBranchCloneViaClient(
  client: Client,
  record: {
    branchName: string;
    tursoDbName: string;
    tursoDbUrl: string;
    tursoAuthToken: string;
    sourceDbName: string;
    createdAt: string;
  },
): Promise<void> {
  await client.execute({
    sql: `INSERT OR REPLACE INTO branch_db_clones
            (branch_name, turso_db_name, turso_db_url, turso_auth_token,
             source_db_name, created_at, last_promoted_at, prod_migration_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
    args: [
      record.branchName,
      record.tursoDbName,
      record.tursoDbUrl,
      record.tursoAuthToken,
      record.sourceDbName,
      record.createdAt,
    ],
  });
}

