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
import {
  loadMigrations,
  extractExpectedSchemaChanges,
  type MigrationFile,
} from '../lib/migrator';
import { FARM_SCHEMA_SQL } from '../lib/farm-schema';
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

// ─── resolveExpectedPrismaSchema ────────────────────────────────────────────
//
// Same shape as `resolveExpectedMigrations` but for the column-parity arm of
// the audit (`checkPrismaColumnParityAcrossTenants`). Pre-issue #215 this
// read `prisma/schema.prisma` from the working tree, which meant every PR
// adding a new column reported "missing column" on every tenant (the
// migration ships in the same PR, so tenants don't have it yet). Same class
// of bug PR #185 fixed for the migration list — extended here.
//
// Returns the schema content as a string; downstream `parsePrismaSchema` +
// `expectedColumnsByTable` handle the rest. Dep-injected for unit testing.

export interface ResolveExpectedPrismaSchemaDeps {
  /**
   * Read `prisma/schema.prisma` from `origin/main`. Returns the file contents
   * on success, or `null` when git can't reach the base ref (forks, shallow
   * clones without `fetch-depth: 0`).
   *
   * An empty-string return is treated as "fall back" by the caller: the file
   * being 0 bytes on main would break Prisma in prod, and silently passing
   * against zero expected columns would mask real drift. See test file
   * header for the full rationale.
   */
  gitReadBaseRefPrismaSchema: () => Promise<string | null>;
  /**
   * Working-tree fallback. Used when `gitReadBaseRefPrismaSchema` returns
   * `null` or an empty string. Reads `prisma/schema.prisma` from disk.
   */
  fsLoadPrismaSchemaFromWorkingTree: () => Promise<string>;
  /** Diagnostic logger. Tests pass `vi.fn()`; CLI passes `console.warn`. */
  log: (msg: string) => void;
}

export async function resolveExpectedPrismaSchema(
  deps: ResolveExpectedPrismaSchemaDeps,
): Promise<string> {
  const fromBase = await deps.gitReadBaseRefPrismaSchema();
  if (fromBase === null) {
    deps.log(
      'audit-schema-parity: origin/main not reachable for prisma/schema.prisma; falling back to working tree',
    );
    return deps.fsLoadPrismaSchemaFromWorkingTree();
  }
  if (fromBase === '') {
    deps.log(
      'audit-schema-parity: origin/main returned empty prisma/schema.prisma; falling back to working tree',
    );
    return deps.fsLoadPrismaSchemaFromWorkingTree();
  }
  return fromBase;
}

async function gitReadBaseRefPrismaSchemaImpl(): Promise<string | null> {
  try {
    const { stdout } = await execFileP(
      'git',
      ['show', 'origin/main:prisma/schema.prisma'],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        // schema.prisma is ~1500 lines; bump from the 1MB default for safety.
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return stdout;
  } catch {
    // origin/main not fetched, or file missing on main — caller falls back.
    return null;
  }
}

async function fsLoadPrismaSchemaFromWorkingTreeImpl(): Promise<string> {
  const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
  return readFile(schemaPath, 'utf-8');
}

// ─── declared-but-uncreated column guard (issue #282, PRD #279 finding #1) ──
//
// The arms above (`checkSchemaParity`, `checkPrismaColumnParity`) both need
// live tenant connectivity and only catch drift once a tenant is already
// broken in prod. This guard is STATIC: it diffs the Prisma-declared column
// set against the union of (canonical bootstrap DDL `FARM_SCHEMA_SQL` + every
// migration's DDL) with zero DB access. It fails when a column is declared in
// `prisma/schema.prisma` but is never created by bootstrap + migrations —
// exactly the FarmSettings incident class (issue #280, 2026-05-16) where 21
// columns lived only on `prisma db push`-ed tenants.
//
// False-positive safety is the dominant risk: this runs in the `gate` with
// `--fail-on-drift`; a false positive jams the prod-promote pipeline
// repo-wide. Both the Prisma schema AND the migration set are sourced from
// `origin/main` (see `resolveExpectedPrismaSchema` /
// `resolveExpectedMigrations`), so a PR that ships a column + its migration
// together stays internally consistent (neither is on main pre-merge; both
// are post-merge). The parse handles quoted identifiers, `@map`/`@@map`,
// relation/array/composite fields (NOT columns), enums-as-TEXT, CREATE TABLE
// bodies (the bootstrap path), and `-- ` comments.

export interface MissingDdlColumn {
  table: string;
  /** The uncreated column, or `'*'` when the whole table has no DDL at all. */
  column: string;
}

/**
 * Strip leading/trailing identifier quotes (`"x"` or `` `x` ``). Mirrors
 * `unquoteIdent` in lib/migrator.ts (kept local to avoid widening that
 * module's export surface for a script-only consumer).
 */
function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('`') && t.endsWith('`'))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Drop `-- ` line comments so narrated (non-executed) DDL isn't parsed. */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/**
 * Extract `table -> Set<column>` for every `CREATE TABLE [IF NOT EXISTS] X (
 * ...body... )` in a SQL string. `extractExpectedSchemaChanges` (lib/migrator)
 * only yields CREATE TABLE *names* + ALTER ADD COLUMN pairs; the bootstrap
 * path creates columns inside the body, so we parse the body here.
 *
 * The first identifier-looking token on each body line is the column name.
 * Lines that are table constraints (`PRIMARY KEY (...)`, `FOREIGN KEY ...`,
 * `CONSTRAINT ...`, `UNIQUE (...)`, `CHECK (...)`) are skipped — they are not
 * columns. Robust to quoted/unquoted identifiers and SQL-keyword table names.
 */
function createTableColumns(sql: string): Map<string, Set<string>> {
  const cleaned = stripLineComments(sql);
  const out = new Map<string, Set<string>>();
  // Match `CREATE TABLE [IF NOT EXISTS] <ident> ( <body> )` — body is the
  // balanced-ish parenthesised region; we stop at the matching close paren
  // at depth 0.
  const headRe = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"]?\w+[`"]?)\s*\(/gi;
  let head: RegExpExecArray | null;
  while ((head = headRe.exec(cleaned))) {
    const table = unquote(head[1]);
    // Walk forward from the opening paren tracking paren depth so nested
    // parens (`DEFAULT (...)`, type sizes) don't terminate the body early.
    let depth = 1;
    let i = head.index + head[0].length;
    const start = i;
    for (; i < cleaned.length && depth > 0; i++) {
      const ch = cleaned[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    const body = cleaned.slice(start, i - 1);
    const cols = out.get(table) ?? new Set<string>();
    // Split the body on top-level commas (depth 0) into definitions.
    let d = 0;
    let cur = '';
    const defs: string[] = [];
    for (const ch of body) {
      if (ch === '(') d++;
      else if (ch === ')') d--;
      if (ch === ',' && d === 0) {
        defs.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) defs.push(cur);
    for (const def of defs) {
      const trimmed = def.trim();
      if (!trimmed) continue;
      // Table-level constraint clauses are not columns.
      if (
        /^(PRIMARY\s+KEY|FOREIGN\s+KEY|CONSTRAINT|UNIQUE|CHECK)\b/i.test(trimmed)
      ) {
        continue;
      }
      const firstTok = /^([`"]?[A-Za-z_]\w*[`"]?)/.exec(trimmed);
      if (!firstTok) continue;
      cols.add(unquote(firstTok[1]));
    }
    out.set(table, cols);
  }
  return out;
}

// ─── frozen legacy baseline (the ratchet) ───────────────────────────────────
//
// `lib/farm-schema.ts FARM_SCHEMA_SQL` is the canonical tenant bootstrap DDL.
// It is historically INCOMPLETE relative to `prisma/schema.prisma`: as of
// this guard's introduction, 61 `table.column` entries are declared in Prisma
// but created by neither the bootstrap DDL nor any numbered migration. They
// only ever materialised on tenants that had been `prisma db push`-ed (the
// forbidden path — see CLAUDE.md "do NOT run prisma db push" and memory
// `feedback-missing-column-premise-vs-prod-shaped-tenant.md`). This is
// pre-existing tech debt; failing on the whole backlog would jam the
// prod-promote pipeline repo-wide for every wave — the exact #280 incident
// this guard exists to prevent the *recurrence* of.
//
// So the guard is a RATCHET, per `feedback-gate-must-validate-real-pr.md`:
// these known entries are grandfathered. The gate fails only on a
// declared-but-uncreated column that is NOT in this frozen set — i.e. a NEW
// regression of the #280/#282 class. The set lives in source on origin/main,
// so a PR is diffed against main's baseline (PR-introduced uncreated columns
// fail; legacy debt does not). Shrinking this list (by fixing the bootstrap
// DDL / adding migrations in a separate scoped wave) is always safe; growing
// it requires a deliberate edit and review. `*` = entire table unbacked.
export const LEGACY_DECLARED_BUT_UNCREATED_BASELINE: ReadonlyArray<string> = [
  'AlertPreference.*',
  'Animal.damNote',
  'Animal.importJobId',
  'Animal.sireNote',
  'Camp.maxGrazingDaysOverride',
  'Camp.restDaysOverride',
  'Camp.rotationNotes',
  'Camp.veldType',
  'CustomField.*',
  'EinsteinChunk.createdAt',
  'EinsteinChunk.embedding',
  'EinsteinChunk.entityId',
  'EinsteinChunk.entityType',
  'EinsteinChunk.id',
  'EinsteinChunk.langTag',
  'EinsteinChunk.modelId',
  'EinsteinChunk.sourceUpdatedAt',
  'EinsteinChunk.text',
  'EinsteinChunk.tokensUsed',
  'GameRainfallRecord.lat',
  'GameRainfallRecord.lng',
  'ImportJob.*',
  'Notification.collapseKey',
  'Notification.dedupKey',
  'Notification.digestDispatchedAt',
  'Notification.payload',
  'Notification.pushDispatchedAt',
  'Notification.updatedAt',
  'NvdRecord.animalIds',
  'NvdRecord.animalSnapshot',
  'NvdRecord.buyerAddress',
  'NvdRecord.buyerContact',
  'NvdRecord.buyerName',
  'NvdRecord.declarationsJson',
  'NvdRecord.destinationAddress',
  'NvdRecord.generatedBy',
  'NvdRecord.id',
  'NvdRecord.issuedAt',
  'NvdRecord.nvdNumber',
  'NvdRecord.pdfHash',
  'NvdRecord.saleDate',
  'NvdRecord.sellerSnapshot',
  'NvdRecord.transactionId',
  'NvdRecord.voidedAt',
  'NvdRecord.voidReason',
  'RagQueryLog.*',
  'RotationPlan.*',
  'RotationPlanStep.*',
  'Task.assigneeIds',
  'Task.blockedByIds',
  'Task.completedObservationId',
  'Task.lat',
  'Task.lng',
  'Task.recurrenceRule',
  'Task.recurrenceSource',
  'Task.reminderOffset',
  'Task.taskType',
  'Task.templateId',
  'TaskOccurrence.*',
  'TaskTemplate.*',
  'VeldAssessment.*',
];

export interface ComputeDeclaredButUncreatedArgs {
  /** `prisma/schema.prisma` source (from origin/main, see resolver above). */
  prismaSchemaSrc: string;
  /** Canonical tenant bootstrap DDL (`lib/farm-schema.ts FARM_SCHEMA_SQL`). */
  bootstrapDdl: string;
  /** Every migration file's name + SQL (from origin/main, see resolver). */
  migrations: ReadonlyArray<Pick<MigrationFile, 'name' | 'sql'>>;
  /**
   * Frozen `table.column` allow-list of pre-existing legacy debt to subtract
   * from the result (the ratchet). Omit (tests) to get the raw diff. CLI
   * passes `LEGACY_DECLARED_BUT_UNCREATED_BASELINE`. An entry of
   * `Table.*` grandfathers the whole table.
   */
  baseline?: ReadonlyArray<string>;
}

/**
 * Pure core of the guard. Returns sorted `{ table, column }` for every
 * Prisma-declared scalar column not created by bootstrap DDL + migrations.
 * A model whose table is created nowhere is reported once as `{ table, '*' }`
 * (column-level noise suppression — the per-tenant arm owns missing-table).
 */
export function computeDeclaredButUncreatedColumns(
  args: ComputeDeclaredButUncreatedArgs,
): MissingDdlColumn[] {
  const expected = expectedColumnsByTable(parsePrismaSchema(args.prismaSchemaSrc));

  // Build the created-column universe: table -> Set<column>.
  const created = new Map<string, Set<string>>();
  const add = (table: string, column: string) => {
    const set = created.get(table) ?? new Set<string>();
    set.add(column);
    created.set(table, set);
  };
  const mergeBodies = (sql: string) => {
    for (const [table, cols] of createTableColumns(sql)) {
      for (const c of cols) add(table, c);
    }
  };
  const mergeAlters = (sql: string) => {
    // extractExpectedSchemaChanges already strips `-- ` comments and parses
    // `ALTER TABLE X ADD COLUMN Y` + CREATE TABLE *names*. We reuse it for
    // the ALTER pairs (single source of truth with the migrator's probe);
    // CREATE TABLE *bodies* come from mergeBodies above.
    const { addColumns, addTables } = extractExpectedSchemaChanges(sql);
    for (const { table, column } of addColumns) add(table, column);
    // Record bare table existence (no columns) so a body-less CREATE TABLE
    // still marks the table as "exists" for the table-level check.
    for (const t of addTables) {
      if (!created.has(t)) created.set(t, new Set<string>());
    }
  };

  mergeBodies(args.bootstrapDdl);
  mergeAlters(args.bootstrapDdl);
  for (const m of args.migrations) {
    mergeBodies(m.sql);
    mergeAlters(m.sql);
  }

  const baseline = new Set(args.baseline ?? []);
  const grandfathered = (table: string, column: string) =>
    baseline.has(`${table}.${column}`) || baseline.has(`${table}.*`);

  const missing: MissingDdlColumn[] = [];
  for (const [table, columns] of expected) {
    const liveCols = created.get(table);
    if (!liveCols) {
      // Whole table has no backing DDL — report once, not per column.
      if (!grandfathered(table, '*')) missing.push({ table, column: '*' });
      continue;
    }
    for (const col of columns) {
      if (!liveCols.has(col) && !grandfathered(table, col)) {
        missing.push({ table, column: col });
      }
    }
  }

  return missing.sort((a, b) =>
    a.table === b.table
      ? a.column.localeCompare(b.column)
      : a.table.localeCompare(b.table),
  );
}

// Base-ref-aware loaders for the static guard's inputs. Same DI + fallback
// contract as `resolveExpectedMigrations` / `resolveExpectedPrismaSchema`:
// read what is merged on `origin/main` so a PR that ships a column + its
// migration + a bootstrap edit together stays internally consistent (none on
// main pre-merge ⇒ no false positive; all on main post-merge ⇒ green). Falls
// back to the working tree only when git can't reach the base ref.

export interface ResolveStaticGuardInputsDeps {
  /**
   * Read every `migrations/*.sql` file's name + content from `origin/main`.
   * Returns `null` when the base ref is unreachable (forks, shallow clones).
   */
  gitReadBaseRefMigrationSqls: () => Promise<
    Array<{ name: string; sql: string }> | null
  >;
  /** Working-tree fallback for the migration SQLs. */
  fsLoadMigrationSqlsFromWorkingTree: () => Promise<
    Array<{ name: string; sql: string }>
  >;
  /**
   * Read the canonical bootstrap DDL string (`lib/farm-schema.ts`
   * `FARM_SCHEMA_SQL`) as it exists on `origin/main`. Returns `null` when
   * unreachable, `''` is treated as fall-back (an empty bootstrap on main
   * would break provisioning anyway and zero expected DDL would mask drift).
   */
  gitReadBaseRefBootstrapDdl: () => Promise<string | null>;
  /** Working-tree fallback for the bootstrap DDL. */
  fsLoadBootstrapDdlFromWorkingTree: () => string;
  log: (msg: string) => void;
}

export async function resolveStaticGuardInputs(
  deps: ResolveStaticGuardInputsDeps,
): Promise<{ bootstrapDdl: string; migrations: Array<{ name: string; sql: string }> }> {
  const baseMigrations = await deps.gitReadBaseRefMigrationSqls();
  const migrations =
    baseMigrations === null
      ? (deps.log(
          'audit-schema-parity: origin/main not reachable for migration SQLs; falling back to working tree',
        ),
        await deps.fsLoadMigrationSqlsFromWorkingTree())
      : baseMigrations;

  const baseDdl = await deps.gitReadBaseRefBootstrapDdl();
  let bootstrapDdl: string;
  if (baseDdl === null) {
    deps.log(
      'audit-schema-parity: origin/main not reachable for lib/farm-schema.ts; falling back to working tree',
    );
    bootstrapDdl = deps.fsLoadBootstrapDdlFromWorkingTree();
  } else if (baseDdl === '') {
    deps.log(
      'audit-schema-parity: origin/main returned empty bootstrap DDL; falling back to working tree',
    );
    bootstrapDdl = deps.fsLoadBootstrapDdlFromWorkingTree();
  } else {
    bootstrapDdl = baseDdl;
  }

  return { bootstrapDdl, migrations };
}

async function gitReadBaseRefMigrationSqlsImpl(): Promise<
  Array<{ name: string; sql: string }> | null
> {
  const names = await gitListBaseRefMigrationsImpl();
  if (names === null) return null;
  const leaf = names
    .filter((p) => p.startsWith('migrations/'))
    .filter((p) => {
      const rest = p.slice('migrations/'.length);
      return !rest.includes('/') && rest.endsWith('.sql');
    });
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const out: Array<{ name: string; sql: string }> = [];
  for (const path of leaf) {
    try {
      const { stdout } = await execFileP('git', ['show', `origin/main:${path}`], {
        cwd,
        maxBuffer: 16 * 1024 * 1024,
      });
      out.push({ name: path.slice('migrations/'.length), sql: stdout });
    } catch {
      return null; // partial read ⇒ treat as unreachable, fall back wholesale
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function fsLoadMigrationSqlsFromWorkingTreeImpl(): Promise<
  Array<{ name: string; sql: string }>
> {
  const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
  const files = await loadMigrations(migrationsDir);
  return files.map((m) => ({ name: m.name, sql: m.sql }));
}

async function gitReadBaseRefBootstrapDdlImpl(): Promise<string | null> {
  try {
    const { stdout } = await execFileP(
      'git',
      ['show', 'origin/main:lib/farm-schema.ts'],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return stdout;
  } catch {
    return null;
  }
}

/** Human-readable report for the CLI / PR comment. Names every offender. */
export function formatDeclaredButUncreatedColumns(
  missing: readonly MissingDdlColumn[],
): string {
  if (missing.length === 0) {
    return '## Declared-but-uncreated columns: GREEN (no drift)\nEvery Prisma-declared column (outside the frozen legacy baseline) is created by bootstrap DDL + migrations.';
  }
  const lines = [
    '## Declared-but-uncreated columns: DRIFT DETECTED',
    'These columns are declared in prisma/schema.prisma but are NEVER created',
    'by the canonical bootstrap DDL (lib/farm-schema.ts) or any migration,',
    'and they are NOT in the frozen legacy baseline — i.e. this PR introduces',
    'a NEW instance of the #280/#282 "no such column" regression class.',
    'A tenant provisioned from bootstrap will 500 on any findMany() that',
    'projects them. Add a migrations/NNNN_*.sql that ADD COLUMNs them (and',
    'ideally fix lib/farm-schema.ts so freshly provisioned tenants get them).',
    '',
  ];
  for (const m of missing) {
    if (m.column === '*') {
      lines.push(`❌ ${m.table}.* (table has no bootstrap/migration DDL at all)`);
    } else {
      lines.push(`❌ ${m.table}.${m.column}`);
    }
  }
  return lines.join('\n');
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
  //
  // Schema source is `origin/main` (with working-tree fallback), same
  // rationale as `resolveExpectedMigrations` above: tenants are promoted
  // from main, so new-in-PR columns must be excluded from the drift
  // check. Issue #215 / mirrors PR #185.
  const prismaSchemaSrc = await resolveExpectedPrismaSchema({
    gitReadBaseRefPrismaSchema: gitReadBaseRefPrismaSchemaImpl,
    fsLoadPrismaSchemaFromWorkingTree: fsLoadPrismaSchemaFromWorkingTreeImpl,
    log: (msg) => console.warn(msg),
  });
  const expectedColumns = expectedColumnsByTable(parsePrismaSchema(prismaSchemaSrc));

  // STATIC declared-but-uncreated guard (issue #282, PRD #279 finding #1).
  // Runs with zero DB access — catches the FarmSettings incident class
  // (#280) at PR time before any tenant is touched. Inputs (migrations +
  // bootstrap DDL) come from origin/main for the same false-positive-safety
  // reason the prisma schema does. Contributes to driftDetected.
  const { bootstrapDdl, migrations: baseMigrationSqls } =
    await resolveStaticGuardInputs({
      gitReadBaseRefMigrationSqls: gitReadBaseRefMigrationSqlsImpl,
      fsLoadMigrationSqlsFromWorkingTree: fsLoadMigrationSqlsFromWorkingTreeImpl,
      gitReadBaseRefBootstrapDdl: gitReadBaseRefBootstrapDdlImpl,
      fsLoadBootstrapDdlFromWorkingTree: () => FARM_SCHEMA_SQL,
      log: (msg) => console.warn(msg),
    });
  const declaredButUncreated = computeDeclaredButUncreatedColumns({
    prismaSchemaSrc,
    bootstrapDdl,
    migrations: baseMigrationSqls,
    baseline: LEGACY_DECLARED_BUT_UNCREATED_BASELINE,
  });

  let driftDetected = declaredButUncreated.length > 0;
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
      declaredButUncreated.length > 0 ||
      results.some((r) => r.error || (r.report && !r.report.ok)) ||
      columnResults.some((r) => r.error || (r.report && !r.report.ok));

    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            expected,
            expectedColumns: Object.fromEntries(expectedColumns),
            declaredButUncreated,
            results,
            columnResults,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(formatDeclaredButUncreatedColumns(declaredButUncreated));
      console.log('');
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
