/**
 * Apply all pending `migrations/*.sql` files to every tenant's Turso DB.
 *
 * Replaces the pattern of writing a hand-rolled `scripts/migrate-*.ts` script
 * per schema change. Adding a new migration is now: drop a new numbered .sql
 * file into `migrations/` and re-run this script.
 *
 * Run with:
 *   pnpm db:migrate           (uses .env.local)
 *   pnpm db:migrate:prod      (uses .env.production)
 */
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';
import { loadMigrations, runMigrations } from '../lib/migrator';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function main() {
  const migrations = await loadMigrations(MIGRATIONS_DIR);
  if (migrations.length === 0) {
    console.log('No migrations in migrations/ — nothing to do.');
    return;
  }

  const slugs = await getAllFarmSlugs();
  console.log(
    `Applying ${migrations.length} migration(s) to ${slugs.length} tenant(s)...`,
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
