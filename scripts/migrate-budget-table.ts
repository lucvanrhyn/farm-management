/**
 * migrate-budget-table.ts — Create the Budget table on every tenant DB
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-budget-table.ts
 */

import { createClient } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';

const CREATE_BUDGET_TABLE = `
CREATE TABLE IF NOT EXISTS "Budget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "categoryName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)
`;

const CREATE_UNIQUE_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS "budget_year_month_category"
ON "Budget"("year", "month", "categoryName")
`;

const CREATE_PERIOD_INDEX = `
CREATE INDEX IF NOT EXISTS "idx_budget_period"
ON "Budget"("year", "month")
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
    await client.execute(CREATE_BUDGET_TABLE);
    await client.execute(CREATE_UNIQUE_INDEX);
    await client.execute(CREATE_PERIOD_INDEX);

    const verify = await client.execute(`PRAGMA table_info("Budget")`);
    console.log(`  [${slug}] ok — ${verify.rows.length} columns`);
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  console.log('\n-- Creating Budget table on all tenant DBs --\n');

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
