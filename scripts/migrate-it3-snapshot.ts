/**
 * migrate-it3-snapshot.ts — Create the It3Snapshot table on every tenant DB
 *
 * Idempotent: uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-it3-snapshot.ts
 */

import { createClient } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';

const CREATE_IT3_SNAPSHOT_TABLE = `
CREATE TABLE IF NOT EXISTS "It3Snapshot" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "taxYear"     INTEGER  NOT NULL,
    "issuedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TEXT     NOT NULL,
    "periodEnd"   TEXT     NOT NULL,
    "payload"     TEXT     NOT NULL,
    "generatedBy" TEXT,
    "pdfHash"     TEXT,
    "voidedAt"    DATETIME,
    "voidReason"  TEXT
)
`;

const CREATE_TAX_YEAR_INDEX = `
CREATE INDEX IF NOT EXISTS "idx_it3_tax_year"
ON "It3Snapshot"("taxYear")
`;

const CREATE_ISSUED_AT_INDEX = `
CREATE INDEX IF NOT EXISTS "idx_it3_issued_at"
ON "It3Snapshot"("issuedAt")
`;

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
    await client.execute(CREATE_IT3_SNAPSHOT_TABLE);
    await client.execute(CREATE_TAX_YEAR_INDEX);
    await client.execute(CREATE_ISSUED_AT_INDEX);

    const verify = await client.execute(`PRAGMA table_info("It3Snapshot")`);
    console.log(`  [${slug}] ok — ${verify.rows.length} columns`);
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  console.log('\n-- Creating It3Snapshot table on all tenant DBs --\n');

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
