/**
 * migrate-rotation-plans.ts — Create RotationPlan + RotationPlanStep tables on every tenant DB
 *
 * Creates:
 *   RotationPlan        — named rotation plans with status lifecycle
 *   RotationPlanStep    — ordered steps within a plan (campId, mobId, plannedStart, plannedDays)
 *
 * Idempotent: uses CREATE TABLE IF NOT EXISTS; safe to run multiple times.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-rotation-plans.ts
 */

import { createClient, type Client } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';

const CREATE_ROTATION_PLAN = `
CREATE TABLE IF NOT EXISTS "RotationPlan" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "startDate" DATETIME NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'draft',
  "notes"     TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
)
`;

const CREATE_ROTATION_PLAN_STEP = `
CREATE TABLE IF NOT EXISTS "RotationPlanStep" (
  "id"                    TEXT NOT NULL PRIMARY KEY,
  "planId"                TEXT NOT NULL,
  "sequence"              INTEGER NOT NULL,
  "campId"                TEXT NOT NULL,
  "mobId"                 TEXT,
  "plannedStart"          DATETIME NOT NULL,
  "plannedDays"           INTEGER NOT NULL,
  "status"                TEXT NOT NULL DEFAULT 'pending',
  "actualStart"           DATETIME,
  "actualEnd"             DATETIME,
  "executedObservationId" TEXT,
  "notes"                 TEXT,
  FOREIGN KEY ("planId") REFERENCES "RotationPlan"("id") ON DELETE CASCADE,
  UNIQUE ("planId", "sequence")
)
`;

const CREATE_INDEX = `
CREATE INDEX IF NOT EXISTS "idx_plan_step_plan_seq"
ON "RotationPlanStep" ("planId", "sequence")
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
    await client.execute(CREATE_ROTATION_PLAN);
    await client.execute(CREATE_ROTATION_PLAN_STEP);
    await client.execute(CREATE_INDEX);
    console.log(`  [${slug}] ok`);
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  console.log('\n-- Creating RotationPlan + RotationPlanStep tables on all tenant DBs --\n');

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
