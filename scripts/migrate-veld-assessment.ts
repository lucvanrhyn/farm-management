/**
 * Idempotently adds VeldAssessment table and FarmSettings.biomeType column
 * to every tenant database. Mirrors scripts/migrate-rotation-planner.ts.
 *
 * Run with:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-veld-assessment.ts
 */
import { createClient, type Client } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "VeldAssessment" (
  "id"                    TEXT PRIMARY KEY,
  "campId"                TEXT NOT NULL,
  "assessmentDate"        TEXT NOT NULL,
  "assessor"              TEXT NOT NULL,
  "palatableSpeciesPct"   REAL NOT NULL,
  "bareGroundPct"         REAL NOT NULL,
  "erosionLevel"          INTEGER NOT NULL,
  "bushEncroachmentLevel" INTEGER NOT NULL,
  "veldScore"             REAL NOT NULL,
  "biomeAtAssessment"     TEXT,
  "haPerLsu"              REAL,
  "notes"                 TEXT,
  "createdAt"             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"             TEXT
);
`;

const INDEX_CAMP_DATE =
  'CREATE INDEX IF NOT EXISTS "idx_veld_assessment_camp_date" ON "VeldAssessment"("campId", "assessmentDate");';
const INDEX_DATE =
  'CREATE INDEX IF NOT EXISTS "idx_veld_assessment_date" ON "VeldAssessment"("assessmentDate");';

async function columnExists(db: Client, table: string, col: string): Promise<boolean> {
  const res = await db.execute(`PRAGMA table_info("${table}")`);
  return res.rows.some((r) => (r.name as string) === col);
}

async function migrateOne(slug: string): Promise<void> {
  const creds = await getFarmCreds(slug);
  if (!creds) {
    console.warn(`[skip] ${slug}: no creds`);
    return;
  }
  const db = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });

  await db.execute(TABLE_SQL);
  await db.execute(INDEX_CAMP_DATE);
  await db.execute(INDEX_DATE);

  if (!(await columnExists(db, 'FarmSettings', 'biomeType'))) {
    await db.execute('ALTER TABLE "FarmSettings" ADD COLUMN "biomeType" TEXT');
    console.log(`[ok] ${slug}: added FarmSettings.biomeType`);
  } else {
    console.log(`[skip] ${slug}: FarmSettings.biomeType already present`);
  }

  db.close();
  console.log(`[done] ${slug}`);
}

async function main() {
  const slugs = await getAllFarmSlugs();
  console.log(`Migrating ${slugs.length} tenant(s)...`);
  for (const slug of slugs) {
    try {
      await migrateOne(slug);
    } catch (err) {
      console.error(`[fail] ${slug}:`, err);
      process.exitCode = 1;
    }
  }
  console.log('Migration complete.');
}

main();
