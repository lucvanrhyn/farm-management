/**
 * migrate-onboarding-complete.ts — Add FarmSettings.onboardingComplete on every tenant DB
 *
 * Adds:
 *   FarmSettings.onboardingComplete  INTEGER NOT NULL DEFAULT 0
 *
 * Backfill: every existing tenant with "substantial data" (> 0 animals) is
 * flagged onboardingComplete = 1, so active farms are NOT bounced to the
 * wizard after deploy. Truly empty tenants stay at the default (0) and will
 * redirect to /onboarding the next time an admin loads /admin.
 *
 * Idempotent: checks PRAGMA table_info before ADD COLUMN (SQLite has no
 * `IF NOT EXISTS` clause on ALTER), and the UPDATE uses a condition that is
 * a no-op once applied.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-onboarding-complete.ts
 */

import { createClient, type Client } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';

const ADD_COLUMN_DDL = `ALTER TABLE "FarmSettings" ADD COLUMN "onboardingComplete" INTEGER NOT NULL DEFAULT 0`;

async function columnExists(client: Client, table: string, name: string): Promise<boolean> {
  const info = await client.execute(`PRAGMA table_info("${table}")`);
  return info.rows.some((row) => row.name === name);
}

async function animalCount(client: Client): Promise<number> {
  try {
    const result = await client.execute(`SELECT COUNT(*) AS n FROM "Animal"`);
    const raw = result.rows[0]?.n;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'bigint') return Number(raw);
    return 0;
  } catch {
    // Animal table missing (fresh tenant that never ran earlier migrations)
    return 0;
  }
}

async function migrateOne(slug: string): Promise<void> {
  const creds = await getFarmCreds(slug);
  if (!creds) {
    console.warn(`  [${slug}] no creds, skipping`);
    return;
  }

  const client = createClient({
    url: creds.tursoUrl,
    authToken: creds.tursoAuthToken,
  });

  try {
    const hasColumn = await columnExists(client, 'FarmSettings', 'onboardingComplete');
    if (!hasColumn) {
      await client.execute(ADD_COLUMN_DDL);
    }

    // Backfill: substantial data (any animals) ⇒ assume onboarding already
    // happened organically. The UPDATE is gated on the current value so it's
    // safe to re-run.
    const animals = await animalCount(client);
    if (animals > 0) {
      await client.execute(
        `UPDATE "FarmSettings" SET "onboardingComplete" = 1 WHERE "onboardingComplete" = 0`,
      );
    }

    const action = hasColumn ? 'column exists' : 'added column';
    console.log(`  [${slug}] ok — ${action}, animals=${animals}, backfilled=${animals > 0}`);
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  console.log('\n-- Adding FarmSettings.onboardingComplete on all tenant DBs --\n');

  const slugs = await getAllFarmSlugs();
  if (slugs.length === 0) {
    console.log('No farms found. Nothing to do.');
    return;
  }

  console.log(`Found ${slugs.length} farm(s): ${slugs.join(', ')}\n`);

  let ok = 0;
  let failed = 0;
  for (const slug of slugs) {
    try {
      await migrateOne(slug);
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`  [${slug}] FAILED:`, err);
    }
  }

  console.log(`\nDone. ${ok} succeeded, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
