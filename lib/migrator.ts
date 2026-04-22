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

export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files = entries
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
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
export async function runMigrations(
  db: Client,
  migrations: MigrationFile[],
): Promise<MigrationResult> {
  await db.execute(CREATE_BOOKKEEPING_TABLE);
  const applied = await getAppliedNames(db);

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
  }

  return { applied: newlyApplied, skipped };
}
