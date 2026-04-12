/**
 * migrate-nvd-fields.ts — Add NVD seller-identity columns to FarmSettings + create NvdRecord table
 *
 * FarmSettings additions:
 *   ownerName            TEXT
 *   ownerIdNumber        TEXT
 *   physicalAddress      TEXT
 *   postalAddress        TEXT
 *   contactPhone         TEXT
 *   contactEmail         TEXT
 *   propertyRegNumber    TEXT
 *   farmRegion           TEXT
 *
 * New table:
 *   NvdRecord — snapshot-based NVD issue log
 *
 * Idempotent: checks PRAGMA table_info before each ADD COLUMN, checks sqlite_master
 * before CREATE TABLE.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-nvd-fields.ts
 */

import { createClient, type Client } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';

interface ColumnSpec {
  readonly name: string;
  readonly ddl: string;
}

const FARM_SETTINGS_COLUMNS: readonly ColumnSpec[] = [
  { name: 'ownerName',         ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "ownerName" TEXT` },
  { name: 'ownerIdNumber',     ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "ownerIdNumber" TEXT` },
  { name: 'physicalAddress',   ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "physicalAddress" TEXT` },
  { name: 'postalAddress',     ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "postalAddress" TEXT` },
  { name: 'contactPhone',      ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "contactPhone" TEXT` },
  { name: 'contactEmail',      ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "contactEmail" TEXT` },
  { name: 'propertyRegNumber', ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "propertyRegNumber" TEXT` },
  { name: 'farmRegion',        ddl: `ALTER TABLE "FarmSettings" ADD COLUMN "farmRegion" TEXT` },
];

const CREATE_NVD_RECORD = `
CREATE TABLE IF NOT EXISTS "NvdRecord" (
  "id"                 TEXT NOT NULL PRIMARY KEY,
  "nvdNumber"          TEXT NOT NULL UNIQUE,
  "issuedAt"           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "saleDate"           TEXT NOT NULL,
  "transactionId"      TEXT,
  "buyerName"          TEXT NOT NULL,
  "buyerAddress"       TEXT,
  "buyerContact"       TEXT,
  "destinationAddress" TEXT,
  "animalIds"          TEXT NOT NULL,
  "animalSnapshot"     TEXT NOT NULL,
  "sellerSnapshot"     TEXT NOT NULL,
  "declarationsJson"   TEXT NOT NULL,
  "generatedBy"        TEXT,
  "pdfHash"            TEXT,
  "voidedAt"           DATETIME,
  "voidReason"         TEXT
)`;

const CREATE_NVD_INDEXES = [
  `CREATE INDEX IF NOT EXISTS "idx_nvd_issued_at" ON "NvdRecord"("issuedAt")`,
  `CREATE INDEX IF NOT EXISTS "idx_nvd_transaction" ON "NvdRecord"("transactionId")`,
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
    // 1. Add FarmSettings columns
    const farmSettingsCols = await existingColumns(client, 'FarmSettings');
    let added = 0;
    let skipped = 0;
    for (const col of FARM_SETTINGS_COLUMNS) {
      if (farmSettingsCols.has(col.name)) {
        skipped += 1;
        continue;
      }
      await client.execute(col.ddl);
      added += 1;
    }

    // 2. Create NvdRecord table
    await client.execute(CREATE_NVD_RECORD);

    // 3. Create indexes
    for (const idx of CREATE_NVD_INDEXES) {
      await client.execute(idx);
    }

    console.log(`  [${slug}] ok — FarmSettings: added ${added}, skipped ${skipped}; NvdRecord table ensured`);
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  console.log('\n-- NVD migration: seller fields + NvdRecord table on all tenant DBs --\n');

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
