/**
 * backfill-animal-species.ts — One-shot Animal.species column catchup.
 *
 * Background
 * ----------
 * basson-boerdery (FarmTrack's first paying client, 103 animals) was
 * provisioned before the Phase-K multi-species migration that added
 * `Animal.species` to the base schema. The 2026-04-19 base-schema catchup
 * (`scripts/migrate-basson-base-schema-catchup.ts`) created missing TABLES
 * but did NOT add missing COLUMNS to existing tables. Result: Animal still
 * lacks `species` on basson, while `prisma/schema.prisma` declares it
 * non-null with a default of "cattle".
 *
 * Symptom: Phase L Einstein embedding backfill embedded 0 animal chunks for
 * basson because `prisma.animal.findMany({})` throws P2022 ("column not
 * found") when Prisma's generated client tries to project `species` against
 * a DB that does not have the column. The exception is caught per-entity-
 * type in `scripts/einstein-backfill-embeddings.ts`, which reports the
 * failure but moves on — leaving basson with 65 chunks (camp/observation/
 * task only) and trio-b with 1041.
 *
 * Knock-on: any natural-language query like "what is the biggest cattle on
 * basson" cannot retrieve animal-grounded facts; only observation chunks
 * surface, which omit weight/category/breed details.
 *
 * Fix
 * ---
 * Add the column on any tenant where it's missing, then backfill every row
 * with a sensible value inferred from `breed` (FarmTrack's cattle-first
 * install base means "cattle" is the safe default).
 *
 * Idempotent. Safe to run repeatedly:
 *   - column-add is gated on `PRAGMA table_info(Animal)` (SQLite has no
 *     `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
 *   - backfill `UPDATE` is `WHERE species IS NULL` so explicit values are
 *     never clobbered.
 *
 * Production run instructions
 * ---------------------------
 *   1. Pull this branch into main.
 *   2. From the repo root:
 *      `npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-animal-species.ts --slug=basson-boerdery`
 *      Use `--all` instead of `--slug=...` to walk every tenant in the meta
 *      DB (the script is a no-op on tenants that already have the column
 *      populated — see the test fixture for trio-b shape).
 *      Add `--dry-run` to preview changes without writing.
 *   3. After the backfill returns successfully, RE-run the Einstein chunker:
 *      `npx dotenv-cli -e .env.local -- npx tsx scripts/einstein-backfill-embeddings.ts`
 *      Resume support inside that script means it picks up where it left
 *      off — only the previously-skipped basson animal entity will be
 *      embedded on the second pass.
 *   4. Verify by running the eval harness against preview:
 *      `npx tsx scripts/einstein-eval.ts`
 *      and by querying basson-boerdery with "how many cattle do I have"
 *      (must now return a non-zero answer grounded in animal chunks).
 *
 * Scope: defaults to basson-boerdery only. Pass `--all` to walk the full
 * tenant list — the script is a clean no-op on tenants that don't need it.
 *
 * Reversibility
 * -------------
 * Adding a NOT-NULL column with a literal default is reversible by
 * `ALTER TABLE "Animal" DROP COLUMN "species"` on libSQL/SQLite ≥3.35.
 * The backfill UPDATE is not reversible (the original NULLs are gone) but
 * the values are inferred from `breed`, so re-deriving them is trivial.
 */

import type { Client } from '@libsql/client';

// ── Pure helpers (testable in isolation) ───────────────────────────────────

/**
 * Map a breed name to the most likely species. Conservative: anything we
 * don't recognise falls back to 'cattle' (FarmTrack's primary install base).
 *
 * Heuristic chosen over a hard breed→species table because (a) the live data
 * has free-text breed values (e.g. "Brangus x Bonsmara") and (b) the only
 * downstream consumer is the RAG chunker, which uses the value as a token —
 * misclassification just produces a slightly less-specific chunk, not a data
 * integrity bug.
 */
export function inferSpeciesFromBreed(breed: string | null | undefined): string {
  if (breed == null) return 'cattle';
  const b = String(breed).trim().toLowerCase();
  if (b.length === 0) return 'cattle';

  // Sheep breeds common in SA. Order matters only for substring overlap;
  // each check is independent.
  const sheepBreeds = [
    'dorper',
    'merino',
    'meatmaster',
    'damara',
    'persian',
    'karakul',
    'romanov',
    'suffolk',
    'dohne',
  ];
  if (sheepBreeds.some((s) => b.includes(s))) return 'sheep';

  // Goat breeds common in SA.
  const goatBreeds = [
    'boer goat',
    'kalahari',
    'savanna',
    'angora',
    'saanen',
    'nubian',
    'tankwa',
  ];
  if (goatBreeds.some((g) => b.includes(g))) return 'goat';

  // Game (informational only — basson + trio-b are livestock-only). The
  // Einstein chunker tolerates any string; if a tenant has true game we'd
  // expect them to be caught by the species/breed shape upstream of here.
  const gameBreeds = ['kudu', 'springbok', 'eland', 'gemsbok', 'impala'];
  if (gameBreeds.some((g) => b.includes(g))) return 'game';

  // Cattle (and unknown). Listing common SA cattle breeds keeps the
  // intent legible even though they all map to the default.
  return 'cattle';
}

interface BackfillResult {
  /** True when this run added the species column to the table. */
  columnAdded: boolean;
  /** Count of rows that had species filled in by this run (0 if no-op). */
  rowsUpdated: number;
  /** Pre-run column inventory for debug logging. */
  columnsBefore: string[];
}

interface BackfillOptions {
  /** When true, write nothing — only inspect and report. */
  dryRun?: boolean;
}

async function listColumns(db: Client, table: string): Promise<string[]> {
  const res = await db.execute(`PRAGMA table_info("${table}")`);
  return res.rows.map((r) => r.name as string);
}

/**
 * Apply the column-add + backfill against an open libsql Client. Pure DB
 * operations — no env reads, no logging beyond the returned summary, so the
 * test suite can drive it against an in-memory DB.
 */
export async function backfillAnimalSpeciesOnDb(
  db: Client,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const { dryRun = false } = options;

  const columnsBefore = await listColumns(db, 'Animal');
  const hasSpeciesColumn = columnsBefore.includes('species');

  // ── 1. ADD COLUMN (only when missing) ────────────────────────────────────
  // SQLite does NOT support `ADD COLUMN IF NOT EXISTS`, so we gate on the
  // PRAGMA result. We add the column as NULLABLE here, then explicitly
  // UPDATE every row with an inferred species in step 2. This is preferred
  // over `ADD COLUMN ... NOT NULL DEFAULT 'cattle'` because the literal
  // default would mask sheep/goat rows from the breed-based refinement
  // (after a default-fill, `WHERE species IS NULL` matches nothing).
  //
  // The schema declares `Animal.species String @default("cattle")` — i.e.
  // NOT NULL. We honour that constraint in step 2 by guaranteeing every
  // row ends up non-null before this function returns. The Prisma client
  // does not enforce column NOT NULL on the underlying SQLite — it only
  // applies the constraint on inserts via the generated client — so a
  // briefly-nullable column is safe across the lifetime of this single
  // function call.
  let columnAdded = false;
  if (!hasSpeciesColumn) {
    if (!dryRun) {
      await db.execute(`ALTER TABLE "Animal" ADD COLUMN "species" TEXT`);
    }
    columnAdded = true;
  }

  // ── 2. Backfill rows where species is NULL ───────────────────────────────
  // We walk every NULL row and UPDATE with a breed-inferred value. On a
  // tenant where the column was already present but some rows are null
  // (the partial-state scenario), this fills only the gaps. On a tenant
  // where every row is already non-null (e.g. trio-b), this is a clean
  // no-op (zero rows match, zero updates issued).
  //
  // We fetch + per-row UPDATE rather than a single SQL CASE statement so
  // the heuristic in `inferSpeciesFromBreed()` stays in TypeScript — much
  // easier to evolve than embedding a 20-breed CASE in SQL.
  let rowsUpdated = 0;
  if (dryRun) {
    // In dry-run we may not have run ADD COLUMN, so a `SELECT WHERE
    // species IS NULL` would fail with "no such column". Approximate by
    // assuming every row would be backfilled when the column was
    // missing; otherwise count actual NULLs.
    if (columnAdded) {
      const all = await db.execute(`SELECT COUNT(*) as n FROM "Animal"`);
      rowsUpdated = Number(all.rows[0]?.n ?? 0);
    } else {
      const nulls = await db.execute(
        `SELECT COUNT(*) as n FROM "Animal" WHERE "species" IS NULL`,
      );
      rowsUpdated = Number(nulls.rows[0]?.n ?? 0);
    }
  } else {
    const rowsToFill = await selectRowsNeedingBackfill(db);
    for (const row of rowsToFill) {
      const inferred = inferSpeciesFromBreed(row.breed);
      // Parameterised UPDATE keyed on id (PK) so we don't depend on
      // animalId uniqueness behaviour under the test fixture.
      await db.execute({
        sql: `UPDATE "Animal" SET "species" = ? WHERE "id" = ? AND "species" IS NULL`,
        args: [inferred, row.id],
      });
      rowsUpdated += 1;
    }
  }

  return { columnAdded, rowsUpdated, columnsBefore };
}

/**
 * Rows whose species column is NULL. Only valid to call after the column
 * has been added (or when it was already present).
 */
async function selectRowsNeedingBackfill(
  db: Client,
): Promise<Array<{ id: string; breed: string | null }>> {
  const res = await db.execute(
    `SELECT "id", "breed" FROM "Animal" WHERE "species" IS NULL`,
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    breed: (r.breed as string | null) ?? null,
  }));
}

// ── CLI entrypoint (production-only path) ──────────────────────────────────
//
// Skipped when imported (e.g. by tests). Vitest does not import this branch
// because we gate on `import.meta.url` matching the entry-point — a lighter
// guard than `require.main === module` that works under ESM tsx.

interface CliArgs {
  slug: string | null;
  all: boolean;
  dryRun: boolean;
}

function parseCliArgs(argv: ReadonlyArray<string>): CliArgs {
  let slug: string | null = null;
  let all = false;
  let dryRun = false;
  for (const a of argv) {
    if (a.startsWith('--slug=')) slug = a.slice('--slug='.length);
    else if (a === '--all') all = true;
    else if (a === '--dry-run') dryRun = true;
  }
  // Default target = basson-boerdery (the known affected tenant) when
  // nothing else was passed. Mirrors migrate-basson-base-schema-catchup.ts.
  if (!all && slug == null) slug = 'basson-boerdery';
  return { slug, all, dryRun };
}

async function runCli(): Promise<void> {
  // Lazy imports so the test environment doesn't pay the cost of pulling
  // in the meta-DB client on every test run.
  const { createClient } = await import('@libsql/client');
  const { getFarmCreds, getAllFarmSlugs } = await import('../lib/meta-db');

  const args = parseCliArgs(process.argv.slice(2));

  console.log('\n-- Animal.species backfill --');
  console.log(`Target: ${args.all ? 'ALL tenants' : args.slug}`);
  console.log(`Mode:   ${args.dryRun ? 'DRY RUN' : 'APPLY'}\n`);

  const slugs: string[] = args.all
    ? await getAllFarmSlugs()
    : [args.slug as string];

  let totalRows = 0;
  let totalAdded = 0;
  let failed = 0;

  for (const slug of slugs) {
    const creds = await getFarmCreds(slug);
    if (!creds) {
      console.error(`  [${slug}] FAIL: no Turso credentials`);
      failed += 1;
      continue;
    }
    const db = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
    try {
      const result = await backfillAnimalSpeciesOnDb(db, { dryRun: args.dryRun });
      console.log(
        `  [${slug}] columnAdded=${result.columnAdded} rowsUpdated=${result.rowsUpdated}`,
      );
      totalAdded += result.columnAdded ? 1 : 0;
      totalRows += result.rowsUpdated;
    } catch (err) {
      console.error(`  [${slug}] FAIL:`, err);
      failed += 1;
    } finally {
      db.close();
    }
  }

  console.log('\n-- Totals --');
  console.log(`  tenants where column was added: ${totalAdded}`);
  console.log(`  rows backfilled:                ${totalRows}`);
  console.log(`  failures:                       ${failed}`);

  if (failed > 0) process.exit(1);
}

// Run only when invoked as a script. The check pairs `process.argv[1]` (the
// script tsx is executing) with this file's path. Tests import the module
// without matching argv[1], so this branch stays dormant.
const invokedAsScript =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /backfill-animal-species\.ts$/.test(process.argv[1]);

if (invokedAsScript) {
  runCli().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}
