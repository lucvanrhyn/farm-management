import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client, InStatement } from '@libsql/client';

/**
 * Tenant-DB migration runner.
 *
 * Each farm's Turso DB gets a `_migrations` table tracking which files under
 * `migrations/` have already been applied. Applying a migration and recording
 * it happen in a single atomic batch — if any statement fails, nothing is
 * persisted and the next run retries from scratch.
 *
 * Migration files live in `migrations/` at the repo root. Naming:
 *   `NNNN_snake_case_description.sql`
 * The numeric prefix defines apply order. Statements inside the file are
 * separated by `;` and run in the declared order. Keep statements DDL-only
 * and avoid semicolons inside string literals (the splitter is intentionally
 * simple — it does not parse SQL).
 */

export interface MigrationFile {
  name: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** Schema changes the probe expects to verify after a migration's batch commits. */
export interface ExpectedSchemaChanges {
  /** Pairs added by `ALTER TABLE … ADD COLUMN`. Probed via `pragma_table_info`. */
  addColumns: Array<{ table: string; column: string }>;
  /** Tables added by `CREATE TABLE [IF NOT EXISTS]`. Probed via `sqlite_master`. */
  addTables: string[];
}

/**
 * Thrown by the post-apply probe when the migration's atomic batch reported
 * success but the live DB doesn't actually carry the expected column/table.
 *
 * The wave/132 root cause was exactly this: Turso silently accepted the
 * batch but rejected the `ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP` clause
 * for non-constant defaults — leaving `_migrations` with the row but the
 * column missing. Every Prisma `findMany()` on the affected table then 500'd
 * with `no such column`. The runner now stamps + verifies + rolls back the
 * `_migrations` row when verification fails, so retries actually retry.
 */
export class MigrationNotPersistedError extends Error {
  constructor(
    public readonly migrationName: string,
    public readonly missing:
      | { kind: 'column'; table: string; column: string }
      | { kind: 'table'; table: string },
  ) {
    const what =
      missing.kind === 'column'
        ? `column "${missing.table}"."${missing.column}"`
        : `table "${missing.table}"`;
    super(
      `Migration ${migrationName} batch reported success but ${what} was not persisted in DB. ` +
        `Bookkeeping row rolled back to allow retry.`,
    );
    this.name = 'MigrationNotPersistedError';
  }
}

const CREATE_BOOKKEEPING_TABLE = `
  CREATE TABLE IF NOT EXISTS "_migrations" (
    "name"       TEXT PRIMARY KEY,
    "applied_at" TEXT NOT NULL
  )
`;

/**
 * Strip the leading-and-trailing identifier quotes (`"foo"` or `` `foo` ``)
 * to recover the bare table/column name SQLite stores in `sqlite_master` and
 * `pragma_table_info`. Unquoted identifiers pass through unchanged.
 */
function unquoteIdent(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('`') && t.endsWith('`'))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

const ALTER_ADD_COLUMN_RE =
  /\bALTER\s+TABLE\s+([`"]?\w+[`"]?)\s+ADD\s+COLUMN\s+([`"]?\w+[`"]?)/gi;

const CREATE_TABLE_RE =
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"]?\w+[`"]?)/gi;

/**
 * Parse a migration's SQL into the schema-change shape the probe will verify.
 *
 * Scope is deliberately narrow:
 *   - `ALTER TABLE X ADD COLUMN Y …` → `(X, Y)` pair to verify via pragma
 *   - `CREATE TABLE [IF NOT EXISTS] X` → `X` to verify via sqlite_master
 *
 * Out of scope: DROP/RENAME/INDEX ops, UPDATE/INSERT/DELETE, ALTER ALTER. The
 * probe is a "did the new schema state land?" check; non-schema statements
 * have nothing to verify after the batch commits.
 *
 * Line comments (`-- ...`) are stripped before parsing so a header that
 * narrates "this file used to do `ALTER TABLE …`" doesn't get parsed as
 * a real DDL claim. The splitter elsewhere uses the same trick.
 */
export function extractExpectedSchemaChanges(sql: string): ExpectedSchemaChanges {
  const stripped = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');

  const addColumns: Array<{ table: string; column: string }> = [];
  for (const m of stripped.matchAll(ALTER_ADD_COLUMN_RE)) {
    addColumns.push({ table: unquoteIdent(m[1]), column: unquoteIdent(m[2]) });
  }

  const addTables: string[] = [];
  for (const m of stripped.matchAll(CREATE_TABLE_RE)) {
    addTables.push(unquoteIdent(m[1]));
  }

  return { addColumns, addTables };
}

const SELECT_TABLE_NAMES = `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`;
const SELECT_COLUMN_NAMES = `SELECT name FROM pragma_table_info(?)`;

/**
 * Confirm the migration's expected schema changes are present in the live DB.
 * Throws `MigrationNotPersistedError` on the first missing column/table.
 *
 * The function is pure I/O — no migration-runner state. Callers (the
 * migrator + post-promote audits) decide what to do on failure.
 *
 * Implementation note: table names are passed as parameters to
 * `pragma_table_info(?)` and `sqlite_master`-WHERE bindings — never
 * string-interpolated — so identifier-injection isn't a concern even for
 * a hypothetical migration whose SQL is operator-supplied.
 */
export async function verifyMigrationApplied(
  db: Client,
  migrationName: string,
  expected: ExpectedSchemaChanges,
): Promise<void> {
  for (const table of expected.addTables) {
    const res = await db.execute({ sql: SELECT_TABLE_NAMES, args: [table] });
    if (res.rows.length === 0) {
      throw new MigrationNotPersistedError(migrationName, { kind: 'table', table });
    }
  }
  for (const { table, column } of expected.addColumns) {
    // Verify the table exists first — pragma_table_info on a missing table
    // returns zero rows (rather than erroring), which would otherwise look
    // identical to a missing column. Surface "table missing" with the right
    // error shape so ops can diagnose at a glance.
    const tableRes = await db.execute({ sql: SELECT_TABLE_NAMES, args: [table] });
    if (tableRes.rows.length === 0) {
      throw new MigrationNotPersistedError(migrationName, { kind: 'table', table });
    }
    const colRes = await db.execute({ sql: SELECT_COLUMN_NAMES, args: [table] });
    const liveCols = new Set(
      colRes.rows
        .map((r) => r.name)
        .filter((n): n is string => typeof n === 'string'),
    );
    if (!liveCols.has(column)) {
      throw new MigrationNotPersistedError(migrationName, {
        kind: 'column',
        table,
        column,
      });
    }
  }
}

export function splitSqlStatements(sql: string): string[] {
  // Strip line comments first so a `-- ...;` doesn't confuse the splitter.
  const stripped = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');

  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Group `.sql` files by their leading `NNNN_` numeric prefix and throw if any
 * prefix has more than one file. The wave/56 SEV-1 outage proved that two
 * files sharing a prefix is unsafe: `runMigrations` keys on the full
 * filename, but `localeCompare` order is not stable across renames, and a
 * post-merge-promote run that picks ordering A while a peer tenant already
 * applied ordering B leaves at least one column from the colliding pair
 * permanently un-applied. Fail fast at load time so the operator renumbers
 * before any tenant DB sees the drift.
 */
function assertNoPrefixCollisions(files: readonly string[]): void {
  const PREFIX_RE = /^(\d{4})_/;
  const buckets = new Map<string, string[]>();
  for (const name of files) {
    const m = PREFIX_RE.exec(name);
    if (!m) continue;
    const prefix = m[1];
    const bucket = buckets.get(prefix);
    if (bucket) bucket.push(name);
    else buckets.set(prefix, [name]);
  }
  const collisions = [...buckets.entries()].filter(([, names]) => names.length > 1);
  if (collisions.length === 0) return;

  const detail = collisions
    .map(([prefix, names]) => `${prefix}: ${names.join(', ')}`)
    .join('; ');
  throw new Error(
    `duplicate migration prefix detected — renumber before deploying: ${detail}`,
  );
}

export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files = entries
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
  assertNoPrefixCollisions(files);
  const out: MigrationFile[] = [];
  for (const name of files) {
    const sql = await readFile(join(dir, name), 'utf-8');
    out.push({ name, sql });
  }
  return out;
}

async function getAppliedNames(db: Client): Promise<Set<string>> {
  const res = await db.execute(`SELECT name FROM "_migrations"`);
  return new Set(res.rows.map((r) => r.name as string));
}

/**
 * Apply any pending migrations to `db`. Safe to call repeatedly — already-
 * applied migrations are skipped. Each migration is applied atomically
 * together with its bookkeeping row: a partial failure rolls back cleanly.
 */
/**
 * Heuristic: does the migration's SQL write to the `_migrations` bookkeeping
 * table itself? Used by `runMigrations` to know when it must re-fetch the
 * applied-set mid-loop. Conservative: any `_migrations` mention triggers a
 * re-fetch — false positives just cost one extra round-trip per migration,
 * false negatives risk the wave/56 SEV-1 (a rename-bookkeeping migration
 * stamps new names, but the in-memory applied-set hasn't seen those rows
 * yet, and the next migration in the loop tries to re-apply them).
 */
function migrationTouchesBookkeeping(sql: string): boolean {
  return /["` ]?_migrations["` ]?/i.test(sql);
}

export async function runMigrations(
  db: Client,
  migrations: MigrationFile[],
): Promise<MigrationResult> {
  await db.execute(CREATE_BOOKKEEPING_TABLE);
  let applied = await getAppliedNames(db);

  const newlyApplied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      skipped.push(migration.name);
      continue;
    }

    const statements = splitSqlStatements(migration.sql);
    if (statements.length === 0) {
      // Empty file — still record it so we don't re-open it every run.
      await db.execute({
        sql: `INSERT INTO "_migrations" (name, applied_at) VALUES (?, ?)`,
        args: [migration.name, new Date().toISOString()],
      });
      newlyApplied.push(migration.name);
      applied.add(migration.name);
      continue;
    }

    const batch: InStatement[] = [
      ...statements.map((s) => ({ sql: s, args: [] as never[] })),
      {
        sql: `INSERT INTO "_migrations" (name, applied_at) VALUES (?, ?)`,
        args: [migration.name, new Date().toISOString()],
      },
    ];

    await db.batch(batch, 'write');

    // Post-apply schema-persistence probe (PRD #128 §10, wave/141). The batch
    // succeeded — but did the schema state the migration claimed actually
    // land? Wave/132 was the loud reminder: Turso accepted the batch yet
    // silently rejected `ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP`, leaving
    // `_migrations` stamped while the column never landed. Probe the live
    // DB for every (table, column) pair the file syntactically claims to add
    // and roll back the bookkeeping row on miss so the next run actually
    // retries instead of skipping a phantom-applied migration.
    const expected = extractExpectedSchemaChanges(migration.sql);
    if (expected.addColumns.length > 0 || expected.addTables.length > 0) {
      try {
        await verifyMigrationApplied(db, migration.name, expected);
      } catch (err) {
        await db.execute({
          sql: `DELETE FROM "_migrations" WHERE name = ?`,
          args: [migration.name],
        });
        throw err;
      }
    }

    newlyApplied.push(migration.name);
    applied.add(migration.name);

    // If this migration wrote to `_migrations` itself (e.g. wave/56's
    // 0008_record_legacy_renames.sql which stamps the renamed 0009..0012
    // names as already-applied for tenants that ran the legacy 0005/0006
    // names), re-fetch the applied-set so the loop respects those rows.
    if (migrationTouchesBookkeeping(migration.sql)) {
      applied = await getAppliedNames(db);
    }
  }

  return { applied: newlyApplied, skipped };
}
