/**
 * Apply all pending migrations:
 *   1. `meta-migrations/*.sql` → meta DB (tracked in `_meta_migrations`).
 *   2. `migrations/*.sql`      → every tenant's Turso DB (tracked in `_migrations`).
 *
 * Meta migrations run first because tenant work can depend on meta state
 * (e.g. branch_db_clones columns written by the soak-gate CI workflow).
 *
 * Adding a meta-DB schema change: drop a new numbered .sql file into
 * `meta-migrations/` and re-run this script. Do NOT write hand-rolled
 * `scripts/migrate-meta-*.ts` scripts.
 *
 * Run with:
 *   pnpm db:migrate           (uses .env.local)
 *   pnpm db:migrate:prod      (uses .env.production)
 */
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { getMetaClient, getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';
import { loadMigrations, runMigrations } from '../lib/migrator';
import { loadMetaMigrations, runMetaMigrations } from '../lib/meta-migrator';

const META_MIGRATIONS_DIR = join(__dirname, '..', 'meta-migrations');
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function runMetaMigrationsStep(): Promise<void> {
  const metaMigrations = await loadMetaMigrations(META_MIGRATIONS_DIR);
  if (metaMigrations.length === 0) {
    console.log('No meta-migrations — skipping meta DB step.');
    return;
  }

  console.log(`\n[meta-db] Applying ${metaMigrations.length} meta-migration(s)...`);
  const metaClient = getMetaClient();
  try {
    const result = await runMetaMigrations(metaClient, metaMigrations);
    if (result.applied.length > 0) {
      console.log(`  [meta-db] applied: ${result.applied.join(', ')}`);
    } else {
      console.log(`  [meta-db] up to date (${result.skipped.length} already applied)`);
    }
  } finally {
    metaClient.close();
  }
}

async function main() {
  // Step 1: meta-DB migrations (runs first).
  await runMetaMigrationsStep();

  // `--meta-only`: skip the tenant fan-out. Used by the CI gate workflow,
  // which only needs `branch_db_clones` schema to be current before cloning a
  // tenant DB; running per-tenant migrations from CI would touch every prod
  // tenant on every PR run, which is the wrong scope for a per-PR check.
  if (process.argv.includes('--meta-only')) {
    return;
  }

  // Step 2: per-tenant migrations.
  const migrations = await loadMigrations(MIGRATIONS_DIR);
  if (migrations.length === 0) {
    console.log('\nNo tenant migrations in migrations/ — nothing to do.');
    return;
  }

  const slugs = await getAllFarmSlugs();
  console.log(
    `\n[tenants] Applying ${migrations.length} migration(s) to ${slugs.length} tenant(s)...`,
  );

  let succeeded = 0;
  let failed = 0;

  for (const slug of slugs) {
    const creds = await getFarmCreds(slug);
    if (!creds) {
      console.warn(`  [${slug}] skip: no creds in meta-db`);
      continue;
    }
    const db = createClient({
      url: creds.tursoUrl,
      authToken: creds.tursoAuthToken,
    });
    try {
      const result = await runMigrations(db, migrations);
      const newCount = result.applied.length;
      if (newCount > 0) {
        console.log(
          `  [${slug}] applied ${newCount} new: ${result.applied.join(', ')}`,
        );
      } else {
        console.log(`  [${slug}] up to date (${result.skipped.length} applied)`);
      }
      succeeded++;
    } catch (err) {
      console.error(`  [${slug}] FAILED:`, err);
      failed++;
    } finally {
      db.close();
    }
  }

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error('Migration runner crashed:', err);
    process.exit(1);
  });
