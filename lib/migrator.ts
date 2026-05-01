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

const CREATE_BOOKKEEPING_TABLE = `
  CREATE TABLE IF NOT EXISTS "_migrations" (
    "name"       TEXT PRIMARY KEY,
    "applied_at" TEXT NOT NULL
  )
`;

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
