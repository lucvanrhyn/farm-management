/**
 * migrate-rotation-planner.ts — Add rotation planner columns to every tenant DB
 *
 * Adds:
 *   FarmSettings.defaultRestDays          INTEGER DEFAULT 60
 *   FarmSettings.defaultMaxGrazingDays    INTEGER DEFAULT 7
 *   FarmSettings.rotationSeasonMode       TEXT    DEFAULT 'auto'
 *   FarmSettings.dormantSeasonMultiplier  REAL    DEFAULT 1.4
 *   Camp.veldType                         TEXT
 *   Camp.restDaysOverride                 INTEGER
 *   Camp.maxGrazingDaysOverride           INTEGER
 *   Camp.rotationNotes                    TEXT
 *
 * Idempotent: checks PRAGMA table_info before each ADD COLUMN, since SQLite's
 * `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS` clause.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-rotation-planner.ts
 */

import { createClient, type Client } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';

interface ColumnSpec {
  readonly table: 'FarmSettings' | 'Camp';
  readonly name: string;
  readonly ddl: string;
}

const COLUMNS: readonly ColumnSpec[] = [
  { table: 'FarmSettings', name: 'defaultRestDays',         ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "defaultRestDays" INTEGER NOT NULL DEFAULT 60` },
  { table: 'FarmSettings', name: 'defaultMaxGrazingDays',   ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "defaultMaxGrazingDays" INTEGER NOT NULL DEFAULT 7` },
  { table: 'FarmSettings', name: 'rotationSeasonMode',      ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "rotationSeasonMode" TEXT NOT NULL DEFAULT 'auto'` },
  { table: 'FarmSettings', name: 'dormantSeasonMultiplier', ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "dormantSeasonMultiplier" REAL NOT NULL DEFAULT 1.4` },
  { table: 'Camp',         name: 'veldType',                ddl: `ALTER TABLE "Camp" ADD COLUMN "veldType" TEXT` },
  { table: 'Camp',         name: 'restDaysOverride',        ddl: `ALTER TABLE "Camp" ADD COLUMN "restDaysOverride" INTEGER` },
  { table: 'Camp',         name: 'maxGrazingDaysOverride',  ddl: `ALTER TABLE "Camp" ADD COLUMN "maxGrazingDaysOverride" INTEGER` },
  { table: 'Camp',         name: 'rotationNotes',           ddl: `ALTER TABLE "Camp" ADD COLUMN "rotationNotes" TEXT` },
];

async function existingColumns(client: Client, table: string): Promise<Set<string>> {
  const info = await client.execute(`PRAGMA table_info("${table}")`);
  const names = new Set<string>();
  for (const row of info.rows) {
    const name = row.name;
    if (typeof name === 'string') names.add(name);
  }
  return names;
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
    const farmSettingsCols = await existingColumns(client, 'FarmSettings');
    const campCols = await existingColumns(client, 'Camp');

    let added = 0;
    let skipped = 0;
    for (const col of COLUMNS) {
      const existing = col.table === 'FarmSettings' ? farmSettingsCols : campCols;
      if (existing.has(col.name)) {
        skipped += 1;
        continue;
      }
      await client.execute(col.ddl);
      added += 1;
    }

    console.log(`  [${slug}] ok — added ${added}, skipped ${skipped} (already present)`);
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  console.log('\n-- Adding rotation planner columns on all tenant DBs --\n');

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
