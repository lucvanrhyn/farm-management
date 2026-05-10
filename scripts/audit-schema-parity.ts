#!/usr/bin/env tsx
/**
 * Schema-parity audit CLI.
 *
 * Established by PRD #128 (2026-05-06). Runs against every tenant in the
 * meta-DB, queries `_migrations`, diffs against the migrations declared on
 * `origin/main`, and reports drift.
 *
 * Usage (governance-gate, before promote, ad-hoc):
 *   pnpm tsx scripts/audit-schema-parity.ts
 *   pnpm tsx scripts/audit-schema-parity.ts --json   # machine-readable
 *   pnpm tsx scripts/audit-schema-parity.ts --fail-on-drift  # exit 1 if drift
 *
 * Environment:
 *   META_TURSO_URL, META_TURSO_AUTH_TOKEN — required.
 *
 * Exit codes:
 *   0 — all tenants at parity (or drift detected without --fail-on-drift)
 *   1 — drift detected with --fail-on-drift
 *   2 — config / connectivity error
 *
 * Design note (gate-fix wave, 2026-05-10):
 *   The "expected" migration list is the set merged on `origin/main`, NOT
 *   the working-tree contents of `migrations/`. A PR that adds a new
 *   migration ships the file in its branch, but tenants are only ever
 *   promoted from main — until merge, tenants legitimately don't have it.
 *   Reading from main excludes new-in-PR files from the missing-check
 *   while still flagging existing-on-main-but-missing-on-tenant (real
 *   drift). Falls back to the working tree on forks / fresh clones where
 *   `origin/main` isn't fetched. See `feedback-ci-workflow-real-run.md`
 *   and `feedback-gate-must-validate-real-pr.md`.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createClient } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';
import { loadMigrations } from '../lib/migrator';
import {
  checkSchemaParityAcrossTenants,
  checkPrismaColumnParityAcrossTenants,
  formatParityResults,
  formatColumnParityResults,
} from '../lib/ops/schema-parity';
import {
  parsePrismaSchema,
  expectedColumnsByTable,
} from '../lib/ops/parse-prisma-schema';

const execFileP = promisify(execFile);

interface CliFlags {
  json: boolean;
  failOnDrift: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: false, failOnDrift: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--json') flags.json = true;
    else if (arg === '--fail-on-drift') flags.failOnDrift = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: audit-schema-parity [--json] [--fail-on-drift]\n\n' +
          '  --json            emit JSON report on stdout\n' +
          '  --fail-on-drift   exit 1 when any tenant is missing migrations',
      );
      process.exit(0);
    }
  }
  return flags;
}

// ─── resolveExpectedMigrations ──────────────────────────────────────────────
//
// Single point of truth for "which migrations are tenants expected to have".
// Returns the migration set merged on `origin/main`, falling back to the
// working tree only when git can't reach the base ref. Dependency-injected
// for unit testing — `gitListBaseRefMigrations` and
// `fsLoadMigrationsFromWorkingTree` are pluggable so tests don't need to
// shell out or touch the filesystem.

export interface ResolveExpectedMigrationsDeps {
  /**
   * Resolve the migration filenames present on `origin/main`. Returns the
   * raw paths from `git ls-tree` (e.g. `migrations/0001_init.sql`,
   * `migrations/rollback/0001.sql`, `migrations/README.md`); the helper
   * filters down to leaf .sql files in `migrations/`.
   *
   * Returns `null` when the base ref is unreachable (forks, shallow clones
   * without `fetch-depth: 0`). Returns `[]` when the base ref exists but
   * has no migrations (legitimate fresh-repo case).
   */
  gitListBaseRefMigrations: () => Promise<string[] | null>;
  /**
   * Working-tree fallback. Used only when `gitListBaseRefMigrations`
   * returns `null`. Returns leaf .sql filenames (no path prefix) — same
   * shape as `lib/migrator.ts loadMigrations()` produces.
   */
  fsLoadMigrationsFromWorkingTree: () => Promise<string[]>;
  /** Diagnostic logger. Tests pass `vi.fn()`; CLI passes `console.warn`. */
  log: (msg: string) => void;
}

export async function resolveExpectedMigrations(
  deps: ResolveExpectedMigrationsDeps,
): Promise<string[]> {
  const fromBase = await deps.gitListBaseRefMigrations();
  if (fromBase === null) {
    deps.log(
      'audit-schema-parity: origin/main not reachable; falling back to working tree',
    );
    return deps.fsLoadMigrationsFromWorkingTree();
  }

  // Filter to leaf .sql files directly under `migrations/`. Excludes
  // `migrations/rollback/*.sql`, `migrations/README.md`, etc.
  const leaf = fromBase
    .filter((p) => p.startsWith('migrations/'))
    .map((p) => p.slice('migrations/'.length))
    .filter((name) => !name.includes('/') && name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
  return leaf;
}

// Production impls of the deps. `gitListBaseRefMigrations` shells out to
// `git ls-tree`; `fsLoadMigrationsFromWorkingTree` walks the directory.

async function gitListBaseRefMigrationsImpl(): Promise<string[] | null> {
  try {
    const { stdout } = await execFileP(
      'git',
      ['ls-tree', '-r', '--name-only', 'origin/main', 'migrations/'],
      { cwd: fileURLToPath(new URL('..', import.meta.url)) },
    );
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    // origin/main not fetched (forks, shallow clones) — caller falls back.
    return null;
  }
}

async function fsLoadMigrationsFromWorkingTreeImpl(): Promise<string[]> {
  // `loadMigrations` reads files + their SQL; we only need names. The script
  // also runs `loadMigrations` separately if needed elsewhere — kept here so
  // the helper has parity with the prior behavior on the fallback path.
  const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
  const files = await loadMigrations(migrationsDir);
  return files.map((m) => m.name);
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(argv: readonly string[]): Promise<number> {
  const flags = parseArgs(argv);

  if (!process.env.META_TURSO_URL || !process.env.META_TURSO_AUTH_TOKEN) {
    console.error('audit-schema-parity: META_TURSO_URL / META_TURSO_AUTH_TOKEN required');
    return 2;
  }

  let slugs: string[];
  try {
    slugs = await getAllFarmSlugs();
  } catch (err) {
    console.error(
      `audit-schema-parity: failed to enumerate farms — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 2;
  }

  // Resolve a libSQL client per tenant. Skip orphans (slug with no creds).
  const tenants: { slug: string; client: ReturnType<typeof createClient>; close: () => void }[] =
    [];
  for (const slug of slugs) {
    const creds = await getFarmCreds(slug);
    if (!creds) {
      console.warn(`[parity] [${slug}] skip: no creds in meta-db`);
      continue;
    }
    const client = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
    tenants.push({ slug, client, close: () => client.close() });
  }

  // Expected list = migrations merged on origin/main (with working-tree
  // fallback). New-in-PR files are excluded so the gate doesn't fail by
  // construction on every PR that ships a new migration. See header comment.
  const expected = await resolveExpectedMigrations({
    gitListBaseRefMigrations: gitListBaseRefMigrationsImpl,
    fsLoadMigrationsFromWorkingTree: fsLoadMigrationsFromWorkingTreeImpl,
    log: (msg) => console.warn(msg),
  });

  // Parse `prisma/schema.prisma` so we can also run the column-parity
  // audit (wave/131, issue #131). This catches the basson-style drift
  // where a column is declared in the schema but never written into a
  // migration file — invisible to the migration-row check above.
  const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
  const prismaSchemaSrc = await readFile(schemaPath, 'utf-8');
  const expectedColumns = expectedColumnsByTable(parsePrismaSchema(prismaSchemaSrc));

  let driftDetected = false;
  try {
    const results = await checkSchemaParityAcrossTenants(
      tenants.map(({ slug, client }) => ({ slug, client })),
      { expected, allowExtra: true },
    );
    const columnResults = await checkPrismaColumnParityAcrossTenants(
      tenants.map(({ slug, client }) => ({ slug, client })),
      { expectedColumns },
    );
    driftDetected =
      results.some((r) => r.error || (r.report && !r.report.ok)) ||
      columnResults.some((r) => r.error || (r.report && !r.report.ok));

    if (flags.json) {
      console.log(
        JSON.stringify(
          { expected, expectedColumns: Object.fromEntries(expectedColumns), results, columnResults },
          null,
          2,
        ),
      );
    } else {
      console.log(formatParityResults(results));
      console.log('');
      console.log(formatColumnParityResults(columnResults));
    }
  } finally {
    for (const t of tenants) {
      try {
        t.close();
      } catch {
        // best-effort
      }
    }
  }

  return driftDetected && flags.failOnDrift ? 1 : 0;
}

// Self-invoke only when run as a script. Importing this file (e.g. from the
// vitest suite) must NOT trigger main(). Standard Node "main module" idiom.
const isMainModule =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMainModule) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error('audit-schema-parity: fatal:', err);
      process.exit(2);
    },
  );
}
