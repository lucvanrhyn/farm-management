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
