/**
 * migrate-rainfall-normal.ts — Create the RainfallNormal table on every tenant DB
 *
 * Idempotent: uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-rainfall-normal.ts
 */

import { createClient } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';

const CREATE_RAINFALL_NORMAL_TABLE = `
CREATE TABLE IF NOT EXISTS "RainfallNormal" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "latitude"    REAL     NOT NULL,
    "longitude"   REAL     NOT NULL,
    "monthIdx"    INTEGER  NOT NULL,
    "meanMm"      REAL     NOT NULL,
    "stdDevMm"    REAL     NOT NULL,
    "sampleYears" INTEGER  NOT NULL,
    "computedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)
`;

const CREATE_UNIQUE_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS "rain_norm_latlng_month"
ON "RainfallNormal"("latitude", "longitude", "monthIdx")
`;

const CREATE_LATLNG_INDEX = `
CREATE INDEX IF NOT EXISTS "idx_rain_norm_latlng"
ON "RainfallNormal"("latitude", "longitude")
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
    await client.execute(CREATE_RAINFALL_NORMAL_TABLE);
    await client.execute(CREATE_UNIQUE_INDEX);
    await client.execute(CREATE_LATLNG_INDEX);

    const verify = await client.execute(`PRAGMA table_info("RainfallNormal")`);
    console.log(`  [${slug}] ok — ${verify.rows.length} columns`);
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  console.log('\n-- Creating RainfallNormal table on all tenant DBs --\n');

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
