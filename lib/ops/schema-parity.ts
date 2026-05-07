import type { Client } from '@libsql/client';

/**
 * Schema-parity checker for prod tenants.
 *
 * Established 2026-05-06 after the Phase A "8 admin routes crashed on prod"
 * incident (PRD #128). Migration `0014_einstein_chunker_version.sql` added
 * `Animal.updatedAt`, `Camp.updatedAt`, `Task.updatedAt`. Every unprojected
 * `prisma.<model>.findMany()` SELECTs them. If the migration didn't apply on
 * a prod tenant, every admin page that does an unprojected findMany 500s with
 * `SqliteError: no such column`.
 *
 * The deep module: given a list of expected migration names + a libSQL client
 * for one tenant, return the diff. No I/O outside `Client.execute`. No
 * meta-DB knowledge. No tenant enumeration. Easy to test against an
 * in-memory `:memory:` libSQL instance.
 *
 * The CLI driver (`scripts/audit-schema-parity.ts`) and the per-tenant verify
 * inside `runProdMigrationsAllTenants` both call this — one source of truth.
 */

export interface SchemaParityReport {
  /** Migration names declared by the migrating PR's `migrations/` directory. */
  expected: string[];
  /** Migration names found in this tenant's `_migrations` table. */
  applied: string[];
  /** Names in `expected` but missing from `applied`. */
  missing: string[];
  /** Names in `applied` but not in `expected`. Only present if `allowExtra:false`. */
  extra: string[];
  /** True iff `missing` is empty and (`allowExtra:true` OR `extra` is empty). */
  ok: boolean;
}

export interface CheckParityOpts {
  /**
   * The list of migration filenames the merging PR ships. The expected list
   * is the union of (already-applied at last promote) and (these files). For
   * the post-promote verify, pass every file in `migrations/` — they should
   * all be present on every tenant.
   */
  expected: readonly string[];
  /**
   * If true, an `applied` set that is a strict superset of `expected` still
   * passes (e.g. test tenants that ran experimental migrations not in main).
   * Default `true` — strict equality is too brittle in practice.
   */
  allowExtra?: boolean;
}

const SELECT_APPLIED_NAMES = `SELECT name FROM "_migrations"`;

/**
 * Read the `_migrations` table from `db` and diff against `expected`.
 *
 * Throws if the table doesn't exist — a tenant with no `_migrations` table
 * has never had any migration applied, which is the most catastrophic
 * possible drift and must surface as an error, not as a "missing all"
 * report.
 */
export async function checkSchemaParity(
  db: Client,
  opts: CheckParityOpts,
): Promise<SchemaParityReport> {
  const allowExtra = opts.allowExtra ?? true;
  let res;
  try {
    res = await db.execute(SELECT_APPLIED_NAMES);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `checkSchemaParity: cannot read "_migrations" — has the tenant ever been migrated? Underlying: ${msg}`,
    );
  }
  const applied = res.rows
    .map((r) => r.name)
    .filter((n): n is string => typeof n === 'string')
    .sort();
  const expectedSorted = [...opts.expected].sort();

  const appliedSet = new Set(applied);
  const expectedSet = new Set(expectedSorted);
  const missing = expectedSorted.filter((n) => !appliedSet.has(n));
  const extra = applied.filter((n) => !expectedSet.has(n));

  const ok = missing.length === 0 && (allowExtra || extra.length === 0);

  return { expected: expectedSorted, applied, missing, extra, ok };
}

export interface TenantParityResult {
  slug: string;
  report?: SchemaParityReport;
  error?: string;
}

/**
 * Convenience: run `checkSchemaParity` against many tenants and aggregate.
 * Continues on per-tenant errors — the final report shows every drift in one
 * pass, mirroring `runProdMigrationsAllTenants`'s "fail-loud-once" pattern.
 */
export async function checkSchemaParityAcrossTenants(
  tenants: ReadonlyArray<{ slug: string; client: Client }>,
  opts: CheckParityOpts,
): Promise<TenantParityResult[]> {
  const results: TenantParityResult[] = [];
  for (const { slug, client } of tenants) {
    try {
      const report = await checkSchemaParity(client, opts);
      results.push({ slug, report });
    } catch (err) {
      results.push({ slug, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

// ───────────────────────────────────────────────────────────────────────────
// Prisma-schema vs live-DB column parity (issue #131, wave/131)
// ───────────────────────────────────────────────────────────────────────────
//
// `checkSchemaParity` above catches drift between migration files and the
// `_migrations` table. It cannot catch a column declared in
// `prisma/schema.prisma` but never written into a migration file — exactly
// the basson `Animal.species` incident from Wave 0. This second checker
// closes that gap.
//
// Parsing the schema is the caller's job (use `parsePrismaSchema` +
// `expectedColumnsByTable` from `./parse-prisma-schema.ts`). This module
// stays I/O-free — it only knows about `Client` and the expected column
// map. The CLI driver and the post-promote verify both call this.

export interface MissingColumn {
  table: string;
  column: string;
}

export interface PrismaColumnParityReport {
  /** Tables that exist in `expected` AND in the live DB. */
  checkedTables: string[];
  /** Tables in `expected` but missing from the live DB entirely. */
  missingTables: string[];
  /** Per-table columns declared in Prisma but absent from the live DB. */
  missing: MissingColumn[];
  /** Always true if `missing` and `missingTables` are both empty. */
  ok: boolean;
}

export interface CheckPrismaColumnParityOpts {
  /**
   * Map of resolved-table-name → expected column names. Build via
   * `expectedColumnsByTable(parsePrismaSchema(source))`.
   *
   * Tables passed here that don't exist in the live DB land in
   * `missingTables` rather than throwing — a tenant can legitimately
   * have a model that hasn't been migrated yet (e.g. wave-in-flight).
   */
  expectedColumns: ReadonlyMap<string, readonly string[]>;
  /**
   * Optional table allow-list. If provided, only these tables are
   * checked. Useful when running against a tenant known to lag a
   * specific model behind during a multi-wave deploy. Default: all
   * tables in `expectedColumns`.
   */
  onlyTables?: readonly string[];
}

const SELECT_TABLE_NAMES = `SELECT name FROM sqlite_master WHERE type='table'`;

/**
 * Read each table's actual column set from `pragma_table_info` and diff
 * against the Prisma-declared expected set. Returns a structured report
 * — caller decides how to surface (CLI / PR comment / SARIF).
 */
export async function checkPrismaColumnParity(
  db: Client,
  opts: CheckPrismaColumnParityOpts,
): Promise<PrismaColumnParityReport> {
  const want = opts.onlyTables
    ? opts.onlyTables.filter((t) => opts.expectedColumns.has(t))
    : [...opts.expectedColumns.keys()];

  // Get the live table list once so we can correctly distinguish
  // "table absent" from "column absent".
  const tablesRes = await db.execute(SELECT_TABLE_NAMES);
  const liveTables = new Set(
    tablesRes.rows
      .map((r) => r.name)
      .filter((n): n is string => typeof n === 'string'),
  );

  const checkedTables: string[] = [];
  const missingTables: string[] = [];
  const missing: MissingColumn[] = [];

  for (const table of want) {
    if (!liveTables.has(table)) {
      missingTables.push(table);
      continue;
    }
    checkedTables.push(table);

    // pragma_table_info returns one row per column. Use the function-form
    // (`pragma_table_info(?)`) so the table name binds as a parameter,
    // not as a SQL-injectable string concat.
    const colRes = await db.execute({
      sql: `SELECT name FROM pragma_table_info(?)`,
      args: [table],
    });
    const liveCols = new Set(
      colRes.rows
        .map((r) => r.name)
        .filter((n): n is string => typeof n === 'string'),
    );

    const expected = opts.expectedColumns.get(table) ?? [];
    for (const col of expected) {
      if (!liveCols.has(col)) missing.push({ table, column: col });
    }
  }

  return {
    checkedTables: checkedTables.sort(),
    missingTables: missingTables.sort(),
    missing: missing.sort((a, b) =>
      a.table === b.table ? a.column.localeCompare(b.column) : a.table.localeCompare(b.table),
    ),
    ok: missing.length === 0 && missingTables.length === 0,
  };
}

export interface TenantColumnParityResult {
  slug: string;
  report?: PrismaColumnParityReport;
  error?: string;
}

/** Convenience: run column parity across many tenants. */
export async function checkPrismaColumnParityAcrossTenants(
  tenants: ReadonlyArray<{ slug: string; client: Client }>,
  opts: CheckPrismaColumnParityOpts,
): Promise<TenantColumnParityResult[]> {
  const results: TenantColumnParityResult[] = [];
  for (const { slug, client } of tenants) {
    try {
      const report = await checkPrismaColumnParity(client, opts);
      results.push({ slug, report });
    } catch (err) {
      results.push({ slug, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/** Format column-parity results for human eyes (CLI / PR comments). */
export function formatColumnParityResults(
  results: readonly TenantColumnParityResult[],
): string {
  const lines: string[] = [];
  let allOk = true;
  for (const { slug, report, error } of results) {
    if (error) {
      allOk = false;
      lines.push(`❌ ${slug} — ERROR: ${error}`);
      continue;
    }
    if (!report) continue;
    if (report.ok) {
      lines.push(`✅ ${slug} — ${report.checkedTables.length} tables at column parity`);
      continue;
    }
    allOk = false;
    const parts: string[] = [];
    if (report.missingTables.length) {
      parts.push(`missing tables: ${report.missingTables.join(', ')}`);
    }
    if (report.missing.length) {
      const grouped = new Map<string, string[]>();
      for (const m of report.missing) {
        if (!grouped.has(m.table)) grouped.set(m.table, []);
        grouped.get(m.table)!.push(m.column);
      }
      const cols = [...grouped.entries()]
        .map(([t, c]) => `${t}.{${c.join(',')}}`)
        .join('; ');
      parts.push(`missing columns: ${cols}`);
    }
    lines.push(`❌ ${slug} — ${parts.join(' | ')}`);
  }
  lines.unshift(
    allOk
      ? '## Prisma column parity: ALL TENANTS GREEN'
      : '## Prisma column parity: DRIFT DETECTED',
  );
  return lines.join('\n');
}

/**
 * Format a parity-results array for human eyes. Used by the CLI driver and
 * by the post-promote workflow's PR comment.
 */
export function formatParityResults(results: readonly TenantParityResult[]): string {
  const lines: string[] = [];
  let allOk = true;
  for (const { slug, report, error } of results) {
    if (error) {
      allOk = false;
      lines.push(`❌ ${slug} — ERROR: ${error}`);
      continue;
    }
    if (!report) continue;
    if (report.ok) {
      lines.push(`✅ ${slug} — at parity (${report.applied.length} applied)`);
      continue;
    }
    allOk = false;
    lines.push(
      `❌ ${slug} — missing: ${report.missing.join(', ') || '(none)'}; extra: ${
        report.extra.join(', ') || '(none)'
      }`,
    );
  }
  lines.unshift(allOk ? '## Schema parity: ALL TENANTS GREEN' : '## Schema parity: DRIFT DETECTED');
  return lines.join('\n');
}
