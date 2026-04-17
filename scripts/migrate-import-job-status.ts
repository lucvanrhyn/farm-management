/**
 * migrate-import-job-status.ts — Add status + completedAt columns to ImportJob on every tenant DB.
 *
 * Idempotent: checks PRAGMA table_info first and only adds missing columns.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-import-job-status.ts
 */

import { createClient } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';

const ADD_STATUS = `ALTER TABLE ImportJob ADD COLUMN status TEXT`;
const ADD_COMPLETED_AT = `ALTER TABLE ImportJob ADD COLUMN completedAt TEXT`;

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
    // Check if ImportJob table exists at all. If missing, the farm never ran
    // workstream-a migration — skip rather than error.
    const tableCheck = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='ImportJob'`,
    );
    if (tableCheck.rows.length === 0) {
      console.log(`  [${slug}] skipped — ImportJob table does not exist (workstream-a migration not run)`);
      return;
    }

    const info = await client.execute(`PRAGMA table_info(ImportJob)`);
    const existing = new Set(
      info.rows.map((r) => String(r.name ?? r[1] ?? '')),
    );

    let added = 0;
    if (!existing.has('status')) {
      await client.execute(ADD_STATUS);
      added += 1;
    }
    if (!existing.has('completedAt')) {
      await client.execute(ADD_COMPLETED_AT);
      added += 1;
    }

    if (added > 0) {
      console.log(`  [${slug}] ok — added ${added} column(s)`);
    } else {
      console.log(`  [${slug}] already migrated (both columns present)`);
    }
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  console.log('\n-- Adding ImportJob.status + ImportJob.completedAt on all tenant DBs --\n');

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
