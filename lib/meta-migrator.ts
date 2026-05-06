import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client, InStatement } from '@libsql/client';
import { splitSqlStatements } from './migrator';
import type { MigrationFile, MigrationResult } from './migrator';

/**
 * Meta-DB migration runner.
 *
 * Mirror of `lib/migrator.ts` for the meta (operator) Turso DB.
 *
 * Migration files live in `meta-migrations/` at the repo root. Naming:
 *   `NNNN_snake_case_description.sql`
 * The numeric prefix defines apply order. Tracking table: `_meta_migrations`
 * on the meta DB. Applying a migration and recording it happen in one atomic
 * batch — if any statement fails, nothing is persisted.
 *
 * `pnpm db:migrate` runs BOTH tenant migrations (via lib/migrator.ts) AND
 * meta migrations (via this module) in sequence — meta first, since some
 * tenant work can depend on meta state (e.g. branch_db_clones columns).
 */

const CREATE_META_BOOKKEEPING_TABLE = `
  CREATE TABLE IF NOT EXISTS "_meta_migrations" (
    "name"       TEXT PRIMARY KEY,
    "applied_at" TEXT NOT NULL
  )
`;

/**
 * Group `.sql` files by their leading `NNNN_` numeric prefix and throw if any
 * prefix has more than one file. Mirrors the wave/56 collision-detector in
 * `lib/migrator.ts` but scoped to the `meta-migrations/` directory.
 *
 * Exported so tests can call it directly and so `loadMetaMigrations` always
 * validates before returning.
 */
export function assertNoMetaPrefixCollisions(files: readonly string[]): void {
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
    `duplicate meta-migration prefix detected — renumber before deploying: ${detail}`,
  );
}

export async function loadMetaMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files = entries
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
  assertNoMetaPrefixCollisions(files);
  const out: MigrationFile[] = [];
  for (const name of files) {
    const sql = await readFile(join(dir, name), 'utf-8');
    out.push({ name, sql });
  }
  return out;
}

async function getAppliedMetaNames(db: Client): Promise<Set<string>> {
  const res = await db.execute(`SELECT name FROM "_meta_migrations"`);
  return new Set(res.rows.map((r) => r.name as string));
}

/**
 * Apply any pending meta-migrations to `db`. Safe to call repeatedly —
 * already-applied migrations are skipped. Each migration is applied atomically
 * together with its bookkeeping row: a partial failure rolls back cleanly.
 */
export async function runMetaMigrations(
  db: Client,
  migrations: MigrationFile[],
): Promise<MigrationResult> {
  await db.execute(CREATE_META_BOOKKEEPING_TABLE);
  const applied = await getAppliedMetaNames(db);

  const newlyApplied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      skipped.push(migration.name);
      continue;
    }

    const statements = splitSqlStatements(migration.sql);
    if (statements.length === 0) {
      await db.execute({
        sql: `INSERT INTO "_meta_migrations" (name, applied_at) VALUES (?, ?)`,
        args: [migration.name, new Date().toISOString()],
      });
      newlyApplied.push(migration.name);
      applied.add(migration.name);
      continue;
    }

    const batch: InStatement[] = [
      ...statements.map((s) => ({ sql: s, args: [] as never[] })),
      {
        sql: `INSERT INTO "_meta_migrations" (name, applied_at) VALUES (?, ?)`,
        args: [migration.name, new Date().toISOString()],
      },
    ];

    await db.batch(batch, 'write');
    newlyApplied.push(migration.name);
    applied.add(migration.name);
  }

  return { applied: newlyApplied, skipped };
}
