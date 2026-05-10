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
 *
 * Phase 3 additions: destroyBranchDb, promoteToProd.
 */
import { createHash } from 'node:crypto';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import type { TursoCli } from '@/lib/ops/turso-cli';
import { realTursoCli, TursoCliError } from '@/lib/ops/turso-cli';
import { getMetaClient, getAllFarmSlugs, getFarmCreds } from '@/lib/meta-db';
import type { FarmCreds } from '@/lib/meta-db';
import { loadMigrations, runMigrations } from '@/lib/migrator';
import type { MigrationResult } from '@/lib/migrator';
import {
  checkSchemaParityAcrossTenants,
  formatParityResults,
} from '@/lib/ops/schema-parity';
import type { TenantParityResult } from '@/lib/ops/schema-parity';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CloneBranchInput {
  /** Git branch name, e.g. 'wave/19-option-c'. */
  branchName: string;
  /** Source Turso DB to clone from, e.g. 'basson-boerdery'. */
  sourceDbName: string;
  /** Prefix for the clone DB name. Defaults to 'ft-clone'. */
  cliPrefix?: string;
  /** Turso DB group to create the clone in. Required when the org has more than one group. */
  groupName?: string;
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
    groupName,
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
  //    a. Create the clone — or adopt an orphan from a prior failed gate run.
  //
  //    Bug pattern (rare but blocking when it strikes): a prior cloneBranch
  //    call created the Turso DB but failed before persisting the meta-DB
  //    row (e.g. the subsequent `db show` or `db tokens` step threw, or the
  //    process was killed). The Turso DB then exists with no meta record,
  //    and every subsequent gate run on the same branch fails with
  //    "already exists" until an operator manually destroys the orphan.
  //
  //    Adoption: when `db create` returns "already exists", treat it as a
  //    successful provision and continue to step 3b/3c, which retrieve the
  //    URL and mint a fresh non-expiring token. Step 4 then writes the
  //    meta record, self-healing the orphan on the next gate run.
  let alreadyExisted = false;
  try {
    await cli.run([
      'db',
      'create',
      tursoDbName,
      '--from-db',
      sourceDbName,
      ...(groupName ? ['--group', groupName] : []),
    ]);
  } catch (err) {
    if (err instanceof TursoCliError && /already exists/i.test(err.stderr)) {
      alreadyExisted = true;
    } else {
      throw err;
    }
  }

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
    alreadyExisted,
  };
}

// ── Phase 3 types ─────────────────────────────────────────────────────────────

export interface DestroyBranchDbInput {
  branchName: string;
  /** Injectable CLI runner. Defaults to the real turso binary. */
  cli?: TursoCli;
  /** Injectable meta-DB client. Defaults to the production singleton. */
  metaClient?: Client;
  /**
   * Skip the turso CLI destroy step. Use when the Turso DB was never created
   * (or was already manually destroyed) and only the meta row needs cleaning.
   */
  skipTursoDestroy?: boolean;
}

export interface DestroyBranchDbResult {
  branchName: string;
  /** true if `turso db destroy` was executed successfully */
  tursoDestroyed: boolean;
  /** true if a meta row existed and was deleted */
  metaRowDeleted: boolean;
}

export interface PromoteToProdInput {
  branchName: string;
  /**
   * The PR head commit SHA being promoted.
   *
   * When provided, the soak gate verifies that THIS sha is the one that soaked
   * (stored as `head_sha` in the meta row) and measures elapsed time from
   * `soak_started_at`. If the stored sha differs, the gate throws
   * {@link SoakNotMetError} with `shaMismatch=true` even if the branch was
   * created hours ago — preventing the re-push bypass (issue #101).
   *
   * When omitted, the gate falls back to `created_at` (backward-compat for
   * callers that have not yet migrated to the SHA-based flow).
   */
  headSha?: string;
  /**
   * Minimum hours between soak start and promote.
   * Defaults to 0.5 hours (30 min) — the new "escalated" tier introduced in
   * issue #178. Pre-#178 default was 1 hour.
   */
  minSoakHours?: number;
  /**
   * Bypass the soak gate explicitly (for emergency hotfixes — must be
   * explicit, not a default).
   */
  forceSkipSoak?: boolean;
  /**
   * Issue #178 conditional soak gate.
   *
   * When `true`, the PR diff touched at least one file in {@link ESCALATED_PATHS}
   * (currently: `lib/migrator.ts`, `lib/ops/branch-clone.ts`). Soak gate
   * enforced with `minSoakHours` floor.
   *
   * When `false`, the PR diff touched no ESCALATED_PATHS file. Soak gate
   * SKIPPED — the structural backstops (`verifyMigrationApplied` #141,
   * `checkPrismaColumnParity` #137, `audit-findmany-no-select` #140) cover
   * the migration-replay class synchronously at promote time without need
   * for temporal observation.
   *
   * When `undefined` (back-compat), behave as if `true` — old callers
   * keep the old soak floor.
   */
  escalatedPathsTouched?: boolean;
  /** Injectable CLI runner (unused by promoteToProd, kept for API symmetry). */
  cli?: TursoCli;
  /** Injectable meta-DB client. Defaults to the production singleton. */
  metaClient?: Client;
  /** Injectable clock. Defaults to () => new Date(). */
  now?: () => Date;
  /**
   * The migrator function to invoke against prod.
   *
   * Defaults to {@link runProdMigrationsAllTenants}, which enumerates every
   * tenant from the meta-DB and runs migrations against each (Wave 4 A1 fix
   * for the Codex CRITICAL "all-tenant migration gap"). In tests, inject a fake.
   */
  runProdMigration?: () => Promise<{ applied: string[]; skipped: string[] }>;
  /**
   * Post-migration parity verifier injected for tests. Defaults to a real
   * cross-tenant check via {@link checkSchemaParityAcrossTenants} that opens
   * a libSQL client for every tenant and asserts every expected migration
   * file is present in `_migrations`.
   *
   * Established by PRD #128 (2026-05-06): the `runProdMigration` step throws
   * if it caught a tenant-level error, but does NOT detect the case where a
   * tenant is missing a migration the runner thought it applied (Turso ack
   * lying, or a tenant that wasn't enumerated). The verifier is the second
   * line of defence — promote will not mark the meta row promoted unless
   * every tenant reports parity.
   */
  verifyAllTenantsParity?: () => Promise<TenantParityResult[]>;
  /**
   * Whether to run the parity verifier. Defaults to `true`. Test callers
   * that don't want to set up the verifier can opt out with `false` — at
   * the cost of bypassing the PRD #128 guarantee, so use sparingly.
   */
  parityVerifyEnabled?: boolean;
}

// ── Issue #101: Per-commit soak bookkeeping ───────────────────────────────────

export interface RecordCiPassInput {
  /** Git branch name, e.g. 'wave/101-soak-gate-commit'. */
  branchName: string;
  /** The full or short commit SHA that just passed CI. */
  commitSha: string;
  /** Injectable meta-DB client. Defaults to the production singleton. */
  metaClient?: Client;
  /** Injectable clock. Defaults to () => new Date(). */
  now?: () => Date;
}

/**
 * Stamp the meta row for a branch with the commit SHA that just passed CI and
 * the timestamp when CI finished (`soak_started_at`).
 *
 * Called by the CI workflow after all checks pass. Resets the soak clock to
 * NOW whenever a new commit's CI completes, so a re-push to an aged branch
 * does not inherit the old soak window (issue #101 fix).
 *
 * Idempotent for the same SHA; overwrites for a new SHA (new push → new soak).
 */
export async function recordCiPassForCommit(
  input: RecordCiPassInput,
): Promise<void> {
  const { branchName, commitSha, now = () => new Date() } = input;
  const metaClient: Client = input.metaClient ?? getMetaClient();

  const soakStartedAt = now().toISOString();
  await metaClient.execute({
    sql: `UPDATE branch_db_clones
          SET head_sha = ?, soak_started_at = ?
          WHERE branch_name = ?`,
    args: [commitSha, soakStartedAt, branchName],
  });
}

export interface PromoteToProdResult {
  branchName: string;
  prodMigrationAppliedFiles: string[];
  prodMigrationSkippedFiles: string[];
  /** ISO timestamp of the promotion moment */
  promotedAt: string;
  /**
   * Per-tenant parity report from the post-migration verify step (PRD #128).
   * Empty array when verify was disabled via `parityVerifyEnabled:false`.
   */
  parityResults: TenantParityResult[];
}

/**
 * Thrown when the post-migration parity verifier finds any tenant missing
 * any expected migration. Carries the human-readable formatted report so
 * the post-merge-promote workflow can paste it directly into the incident.
 */
export class TenantParityFailedError extends Error {
  constructor(
    readonly results: TenantParityResult[],
    readonly formatted: string,
  ) {
    super(`Tenant parity verification failed after prod migration:\n${formatted}`);
    this.name = 'TenantParityFailedError';
  }
}

export class SoakNotMetError extends Error {
  constructor(
    readonly branchName: string,
    readonly soakHoursElapsed: number,
    readonly minSoakHours: number,
    /** true when the promote headSha differs from the stored head_sha (re-push bypass) */
    readonly shaMismatch: boolean = false,
  ) {
    super(
      shaMismatch
        ? `Branch '${branchName}' head SHA mismatch — a new commit was pushed after soak started. Re-soak required.`
        : `Branch '${branchName}' has only soaked ${soakHoursElapsed.toFixed(2)}h of the required ${minSoakHours}h before promote.`,
    );
    this.name = 'SoakNotMetError';
  }
}

export class BranchCloneNotFoundError extends Error {
  constructor(readonly branchName: string) {
    super(`Branch clone record not found for branch: '${branchName}'`);
    this.name = 'BranchCloneNotFoundError';
  }
}

// ── Issue #178: Conditional soak gate ────────────────────────────────────────

/**
 * Paths whose modification triggers the soak gate. Kept narrow on purpose:
 * - `lib/migrator.ts`: the migration runner. If buggy, all migrations affected.
 * - `lib/ops/branch-clone.ts`: the gate logic itself. Bootstrapping concern —
 *   if THIS file is buggy, the soak check itself can't be trusted; soak gives
 *   a window for human inspection before propagation.
 *
 * NOT included (covered by structural backstops at promote time):
 * - `migrations/**` — `verifyMigrationApplied` (#141) catches per-tenant drift
 * - `prisma/schema.prisma` — `tsc` + `checkPrismaColumnParity` (#137) catch drift
 *
 * To re-enable blanket soak: set `effectiveSoakHours = minSoakHours` unconditionally
 * in `promoteToProd`. One-line revert.
 */
export const ESCALATED_PATHS: ReadonlyArray<RegExp> = [
  /^lib\/migrator\.ts$/,
  /^lib\/ops\/branch-clone\.ts$/,
];

/**
 * Helper: given a list of changed file paths (from `git diff --name-only`),
 * determine whether the diff touches the ESCALATED set.
 */
export function diffTouchesEscalated(changedPaths: ReadonlyArray<string>): boolean {
  for (const path of changedPaths) {
    for (const re of ESCALATED_PATHS) {
      if (re.test(path)) return true;
    }
  }
  return false;
}

// ── Phase 3 functions ─────────────────────────────────────────────────────────

/**
 * Destroy the Turso DB clone for a branch and delete its meta row.
 *
 * Idempotent: if no meta row exists, returns false/false without touching Turso.
 * Atomic around failure: if Turso destroy fails, the meta row is preserved so
 * the operator can retry with skipTursoDestroy=true after manual cleanup.
 */
export async function destroyBranchDb(
  input: DestroyBranchDbInput,
): Promise<DestroyBranchDbResult> {
  const {
    branchName,
    cli = realTursoCli,
    skipTursoDestroy = false,
  } = input;

  const metaClient: Client = input.metaClient ?? getMetaClient();

  // 1. Look up the existing row.
  const existing = await _getBranchCloneViaClient(metaClient, branchName);
  if (!existing) {
    return { branchName, tursoDestroyed: false, metaRowDeleted: false };
  }

  // 2. Optionally run the turso CLI destroy step.
  if (!skipTursoDestroy) {
    // Throws TursoCliError on failure — meta row is NOT deleted in that case.
    await cli.run(['db', 'destroy', existing.tursoDbName, '--yes']);
  }

  // 3. Delete the meta row (only reached if turso destroy succeeded or was skipped).
  await _deleteBranchCloneViaClient(metaClient, branchName);

  return {
    branchName,
    tursoDestroyed: !skipTursoDestroy,
    metaRowDeleted: true,
  };
}

/**
 * Options for {@link runProdMigrationsAllTenants}.
 *
 * All fields are injectable so tests can verify the per-tenant fan-out without
 * touching real Turso endpoints or the meta-DB singleton. Production callers
 * leave them undefined to get the real wiring (meta-DB enumeration + libSQL
 * client per tenant + migrations/ folder at repo root).
 */
export interface RunProdMigrationsAllTenantsOpts {
  /**
   * Meta-DB client. Reserved for forward-compat — current default helpers
   * (`getAllFarmSlugs`, `getFarmCreds`) read from the singleton, but tests
   * still pass it for documentation and to make the dependency explicit.
   */
  metaClient?: Client;
  /** Slug enumerator. Defaults to the meta-DB-backed `getAllFarmSlugs`. */
  getSlugs?: () => Promise<string[]>;
  /** Per-slug creds lookup. Defaults to the meta-DB-backed `getFarmCreds`. */
  getCredsForSlug?: (slug: string) => Promise<FarmCreds | null>;
  /**
   * Per-tenant migration runner. Receives the slug + the resolved creds and
   * must apply pending migrations to that tenant's DB. Defaults to a real
   * libSQL client + the migrator at `migrations/`.
   */
  runForTenant?: (slug: string, creds: FarmCreds) => Promise<MigrationResult>;
}

/**
 * Default per-tenant migration runner — opens a libSQL client against the
 * tenant's URL/token, loads the bundled migrations directory once, applies
 * pending migrations, and closes the client. Used by
 * {@link runProdMigrationsAllTenants} when `runForTenant` is not injected.
 */
async function _defaultRunForTenant(
  _slug: string,
  creds: FarmCreds,
): Promise<MigrationResult> {
  const tenantClient = createClient({
    url: creds.tursoUrl,
    authToken: creds.tursoAuthToken,
  });
  try {
    const migrationsDir = new URL('../../migrations', import.meta.url).pathname;
    const migrations = await loadMigrations(migrationsDir);
    return await runMigrations(tenantClient, migrations);
  } finally {
    tenantClient.close();
  }
}

/**
 * Run pending migrations against EVERY tenant DB enumerated from the meta-DB.
 *
 * Wave 4 A1 fix (Codex CRITICAL, 2026-05-02): the previous default only
 * migrated the single DB pointed to by `PROD_TENANT_DB_URL`, so any tenant
 * onboarded after Basson Boerdery would silently miss schema changes at
 * promote time. This helper now mirrors `scripts/migrate.ts`'s loop:
 *
 *   1. Enumerate all farm slugs from the meta-DB.
 *   2. For each slug, resolve its Turso creds via the meta-DB. If a slug has
 *      no creds (orphan row), warn + skip.
 *   3. Apply pending migrations to that tenant. Collect applied/skipped lists
 *      with slug prefixes for traceability.
 *   4. If ANY tenant throws, attempt all remaining tenants first (so the
 *      operator sees the full damage report), then throw an aggregate error
 *      so the post-merge-promote workflow's `if: failure()` step opens an
 *      incident. Never silently swallow per-tenant failures.
 */
export async function runProdMigrationsAllTenants(
  opts: RunProdMigrationsAllTenantsOpts = {},
): Promise<{ applied: string[]; skipped: string[] }> {
  const getSlugs = opts.getSlugs ?? getAllFarmSlugs;
  const getCreds = opts.getCredsForSlug ?? getFarmCreds;
  const runForTenant = opts.runForTenant ?? _defaultRunForTenant;

  const slugs = await getSlugs();
  const aggregateApplied: string[] = [];
  const aggregateSkipped: string[] = [];
  const failures: { slug: string; error: unknown }[] = [];

  for (const slug of slugs) {
    const creds = await getCreds(slug);
    if (!creds) {
      // Mirrors scripts/migrate.ts:39-42 — orphan slug, warn + continue.
      console.warn(`[promote] [${slug}] skip: no creds in meta-db`);
      continue;
    }
    try {
      const result = await runForTenant(slug, creds);
      for (const name of result.applied) aggregateApplied.push(`${slug}:${name}`);
      for (const name of result.skipped) aggregateSkipped.push(`${slug}:${name}`);
    } catch (err) {
      // Record + continue so we surface every failure in one aggregate throw.
      failures.push({ slug, error: err });
      console.error(`[promote] [${slug}] FAILED:`, err);
    }
  }

  if (failures.length > 0) {
    const detail = failures
      .map((f) => `${f.slug}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
      .join('; ');
    throw new Error(
      `Prod migration failed for ${failures.length}/${slugs.length} tenant(s): ${detail}`,
    );
  }

  return { applied: aggregateApplied, skipped: aggregateSkipped };
}

/**
 * Default `runProdMigration` injected into {@link promoteToProd}.
 *
 * Thin wrapper that delegates to {@link runProdMigrationsAllTenants} with no
 * overrides — production wiring uses the singleton meta-DB client and a real
 * libSQL connection per tenant.
 */
async function _defaultRunProdMigration(): Promise<{ applied: string[]; skipped: string[] }> {
  return runProdMigrationsAllTenants();
}

/**
 * Default tenant-parity verifier injected into {@link promoteToProd}.
 *
 * Established by PRD #128 (2026-05-06). Iterates every farm slug from the
 * meta-DB, opens a libSQL client to that tenant, and asserts every
 * migration file in `migrations/` is present in `_migrations`. The
 * `expected` list is the file names; allowExtra defaults to true so
 * tenants that experimentally ran an extra migration don't fail parity.
 *
 * Closes each tenant client in `finally` so we don't leak file handles
 * even if one tenant errors mid-loop.
 */
async function _defaultVerifyAllTenantsParity(): Promise<TenantParityResult[]> {
  const slugs = await getAllFarmSlugs();
  const tenants: { slug: string; client: Client; close: () => void }[] = [];
  for (const slug of slugs) {
    const creds = await getFarmCreds(slug);
    if (!creds) {
      tenants.push({
        slug,
        // Push a sentinel so the consumer sees a per-tenant error.
        client: null as unknown as Client,
        close: () => {},
      });
      continue;
    }
    const client = createClient({
      url: creds.tursoUrl,
      authToken: creds.tursoAuthToken,
    });
    tenants.push({ slug, client, close: () => client.close() });
  }

  const migrationsDir = new URL('../../migrations', import.meta.url).pathname;
  const expected = (await loadMigrations(migrationsDir)).map((m) => m.name);

  try {
    return await checkSchemaParityAcrossTenants(
      tenants
        .filter((t) => t.client !== null)
        .map(({ slug, client }) => ({ slug, client })),
      { expected, allowExtra: true },
    );
  } finally {
    for (const t of tenants) {
      try {
        t.close();
      } catch {
        // best-effort
      }
    }
  }
}

/**
 * Promote a branch clone to prod by:
 * 1. Checking the clone exists.
 * 2. Enforcing the soak gate (minSoakHours since clone creation).
 * 3. Running prod migrations.
 * 4. Marking the meta row promoted.
 *
 * If any step fails, the meta row is left unchanged.
 */
export async function promoteToProd(
  input: PromoteToProdInput,
): Promise<PromoteToProdResult> {
  const {
    branchName,
    headSha,
    minSoakHours = 0,
    forceSkipSoak = false,
    escalatedPathsTouched,
    now = () => new Date(),
    runProdMigration = _defaultRunProdMigration,
    verifyAllTenantsParity = _defaultVerifyAllTenantsParity,
    parityVerifyEnabled = true,
  } = input;

  const metaClient: Client = input.metaClient ?? getMetaClient();

  // 1. Fetch the meta row — must exist.
  const row = await _getBranchCloneFullViaClient(metaClient, branchName);
  if (!row) {
    throw new BranchCloneNotFoundError(branchName);
  }

  // 2. Soak gate — disabled by default per Wave 179 audit (#179).
  //
  // Empirical record: 60+ merges, 0 bugs caught by soak. The structural
  // backstops shipped in PRD #128 (verifyMigrationApplied #141, parity
  // audit #137, no-select audit #140) plus the post-promote authenticated
  // smoke (rolls back on 500/error-boundary) cover the entire known
  // failure surface synchronously at promote time. The temporal soak
  // window adds nothing real — it sleeps a CI runner, not real traffic.
  //
  // The bookkeeping infrastructure (soak_started_at column,
  // recordCiPassForCommit, escalatedPathsTouched parameter, headSha SHA
  // match) is RETAINED for one-line revertability. To re-enable, change
  // `minSoakHours = 0` back to `0.5` (escalated-only) or `1` (blanket).
  //
  // Issue #101 SHA mismatch check (preserved): when headSha is provided,
  // a stored mismatch still throws SoakNotMetError(shaMismatch=true).
  // This protects against the "post-CI-green commit pushed before soak
  // started" race regardless of minSoakHours value.
  if (!forceSkipSoak) {
    const isEscalated = escalatedPathsTouched !== false; // undefined -> true
    if (isEscalated) {
      const nowMs = now().getTime();

      if (headSha !== undefined) {
        // SHA-based gate (issue #101 fix)
        if (row.headSha !== headSha) {
          // Telemetry: soak SHA mismatch — new commit pushed after soak started
          console.warn(
            `[promote] [soak_sha_mismatch] branch=${branchName} stored=${row.headSha ?? 'none'} requested=${headSha}`,
          );
          throw new SoakNotMetError(branchName, 0, minSoakHours, /* shaMismatch */ true);
        }
        // SHA matches — measure elapsed from soak_started_at
        const soakStartMs = row.soakStartedAt
          ? new Date(row.soakStartedAt).getTime()
          : new Date(row.createdAt).getTime();
        const elapsedHours = (nowMs - soakStartMs) / (1000 * 60 * 60);
        if (elapsedHours < minSoakHours) {
          throw new SoakNotMetError(branchName, elapsedHours, minSoakHours);
        }
      } else {
        // Backward-compat: no headSha provided → use created_at
        const createdAtMs = new Date(row.createdAt).getTime();
        const elapsedHours = (nowMs - createdAtMs) / (1000 * 60 * 60);
        if (elapsedHours < minSoakHours) {
          throw new SoakNotMetError(branchName, elapsedHours, minSoakHours);
        }
      }
    } else {
      // Pure-transport PR — fast path. Skip soak entirely.
      // Backstops (#137 parity audit, #140 no-select audit, #141
      // verifyMigrationApplied) run synchronously below in the migration
      // step. No temporal observation needed.
      console.log(
        `[promote] [soak_skipped_pure_transport] branch=${branchName} sha=${headSha ?? 'unknown'}`,
      );
    }
  }

  // 3. Run prod migration — error bubbles up, leaving meta row untouched.
  const migrationResult = await runProdMigration();

  // 3.5 Verify per-tenant schema parity (PRD #128).
  //
  // The migration runner already throws if any per-tenant `runForTenant`
  // call rejected. This step is the second line of defence: re-query
  // `_migrations` on every tenant and assert every shipped migration name
  // is present. Catches Turso ack-lying, unenumerated tenants, and
  // catastrophic state drift the migration runner cannot see.
  let parityResults: TenantParityResult[] = [];
  if (parityVerifyEnabled) {
    parityResults = await verifyAllTenantsParity();
    const drift = parityResults.filter((r) => r.error || (r.report && !r.report.ok));
    if (drift.length > 0) {
      throw new TenantParityFailedError(parityResults, formatParityResults(parityResults));
    }
  }

  // 4. Mark promoted in meta-DB.
  const promotedAt = now().toISOString();
  await _markBranchClonePromotedViaClient(metaClient, branchName, promotedAt);

  return {
    branchName,
    prodMigrationAppliedFiles: migrationResult.applied,
    prodMigrationSkippedFiles: migrationResult.skipped,
    promotedAt,
    parityResults,
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
             source_db_name, created_at, last_promoted_at, prod_migration_at,
             head_sha, soak_started_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
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

async function _getBranchCloneFullViaClient(
  client: Client,
  branchName: string,
): Promise<{
  branchName: string;
  tursoDbName: string;
  tursoDbUrl: string;
  tursoAuthToken: string;
  sourceDbName: string;
  createdAt: string;
  lastPromotedAt: string | null;
  prodMigrationAt: string | null;
  /** Commit SHA that last passed CI and started the soak window (issue #101). */
  headSha: string | null;
  /** ISO timestamp when CI passed for headSha — start of the soak window (issue #101). */
  soakStartedAt: string | null;
} | null> {
  const result = await client.execute({
    sql: `SELECT branch_name, turso_db_name, turso_db_url, turso_auth_token,
                 source_db_name, created_at, last_promoted_at, prod_migration_at,
                 head_sha, soak_started_at
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
    sourceDbName: row.source_db_name as string,
    createdAt: row.created_at as string,
    lastPromotedAt: (row.last_promoted_at as string) ?? null,
    prodMigrationAt: (row.prod_migration_at as string) ?? null,
    headSha: (row.head_sha as string) ?? null,
    soakStartedAt: (row.soak_started_at as string) ?? null,
  };
}

async function _deleteBranchCloneViaClient(
  client: Client,
  branchName: string,
): Promise<void> {
  await client.execute({
    sql: `DELETE FROM branch_db_clones WHERE branch_name = ?`,
    args: [branchName],
  });
}

async function _markBranchClonePromotedViaClient(
  client: Client,
  branchName: string,
  promotedAt: string,
): Promise<void> {
  await client.execute({
    sql: `UPDATE branch_db_clones
          SET last_promoted_at = ?, prod_migration_at = ?
          WHERE branch_name = ?`,
    args: [promotedAt, promotedAt, branchName],
  });
}

