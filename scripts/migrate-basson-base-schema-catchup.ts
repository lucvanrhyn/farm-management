/**
 * migrate-basson-base-schema-catchup.ts — One-shot schema catchup for acme-cattle
 *
 * Background: acme-cattle (FarmTrack's first paying client, 103 animals) was
 * provisioned before several base-schema tables existed. A 2026-04-19 audit vs
 * delta-livestock surfaced 18 tables present on trio-b but missing on basson:
 *
 *   AlertPreference, FarmSpeciesSettings, Notification, PushSubscription,
 *   GameCensusEvent, GameCensusResult, GameHuntAnimal, GameHuntRecord,
 *   GameInfrastructure, GameIntroduction, GameMortality, GameOfftakeQuota,
 *   GamePermit, GamePredationEvent, GameRainfallRecord, GameSpecies,
 *   GameVeldCondition, GameWaterPoint
 *
 * As a result, core notifications never worked for this tenant, and Phase J
 * (`migrate-alert-prefs.ts`) refuses to run on basson because it requires
 * Notification to exist.
 *
 * This script CREATEs the missing tables (with their indices) using the exact
 * column types observed live on delta-livestock — no `prisma db push` (CLAUDE.md
 * forbids it; it breaks Turso). After this runs, re-running migrate-alert-prefs.ts
 * is expected to be a near-no-op (Notification & AlertPreference already exist;
 * only the FarmSettings.quietHours* columns get added).
 *
 * Idempotent: every statement uses `CREATE TABLE IF NOT EXISTS` /
 * `CREATE INDEX IF NOT EXISTS`. Safe to re-run.
 *
 * Scope: hard-coded to slug='acme-cattle'. Do NOT generalise this to all
 * tenants — delta-livestock already has these tables, and other tenants must
 * use the standard provisioning path.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-basson-base-schema-catchup.ts
 */

import { createClient, type Client } from '@libsql/client';
import { getFarmCreds } from '../lib/meta-db';

const TARGET_SLUG = 'acme-cattle';

// ── Table DDL — copied from live delta-livestock sqlite_master ─────────────
// IF NOT EXISTS added so the script is fully idempotent.

const CREATE_TABLES: ReadonlyArray<{ name: string; sql: string }> = [
  {
    name: 'Notification',
    sql: `CREATE TABLE IF NOT EXISTS "Notification" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "type" TEXT NOT NULL,
      "severity" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "href" TEXT NOT NULL,
      "isRead" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" DATETIME NOT NULL,
      "dedupKey" TEXT,
      "payload" TEXT,
      "collapseKey" TEXT,
      "updatedAt" DATETIME
    )`,
  },
  {
    name: 'PushSubscription',
    sql: `CREATE TABLE IF NOT EXISTS "PushSubscription" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "endpoint" TEXT NOT NULL,
      "p256dh" TEXT NOT NULL,
      "auth" TEXT NOT NULL,
      "userEmail" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'AlertPreference',
    sql: `CREATE TABLE IF NOT EXISTS "AlertPreference" (
      "id"              TEXT PRIMARY KEY,
      "userId"          TEXT NOT NULL,
      "category"        TEXT NOT NULL,
      "alertType"       TEXT,
      "channel"         TEXT NOT NULL,
      "enabled"         INTEGER NOT NULL DEFAULT 1,
      "digestMode"      TEXT NOT NULL DEFAULT 'realtime',
      "speciesOverride" TEXT,
      "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AlertPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
    )`,
  },
  {
    name: 'FarmSpeciesSettings',
    sql: `CREATE TABLE IF NOT EXISTS "FarmSpeciesSettings" (
      id TEXT PRIMARY KEY NOT NULL,
      species TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      gestationDays INTEGER,
      voluntaryWaitingDays INTEGER,
      breedingSeasonStart TEXT,
      breedingSeasonEnd TEXT,
      weaningAgeDays INTEGER,
      targetStockingRate REAL,
      customLsuValues TEXT,
      customCategories TEXT,
      quotaConfig TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameSpecies',
    sql: `CREATE TABLE IF NOT EXISTS "GameSpecies" (
      id TEXT PRIMARY KEY NOT NULL,
      commonName TEXT NOT NULL UNIQUE,
      scientificName TEXT,
      dietaryClass TEXT NOT NULL,
      lsuEquivalent REAL NOT NULL,
      averageMassKg REAL,
      isTops INTEGER NOT NULL DEFAULT 0,
      defaultMortalityRate REAL NOT NULL DEFAULT 0.05,
      defaultRecruitmentRate REAL NOT NULL DEFAULT 0.30,
      gestationDays INTEGER,
      trophyMinRW REAL,
      trophyMinSCI REAL,
      targetPopulation INTEGER,
      currentEstimate INTEGER NOT NULL DEFAULT 0,
      lastCensusDate TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameCensusEvent',
    sql: `CREATE TABLE IF NOT EXISTS "GameCensusEvent" (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      method TEXT NOT NULL,
      observer TEXT NOT NULL,
      conditions TEXT,
      confidenceLevel TEXT NOT NULL DEFAULT 'moderate',
      marginOfError REAL,
      costRands REAL,
      notes TEXT,
      areaHectares REAL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameCensusResult',
    sql: `CREATE TABLE IF NOT EXISTS "GameCensusResult" (
      id TEXT PRIMARY KEY NOT NULL,
      censusEventId TEXT NOT NULL,
      speciesId TEXT NOT NULL,
      totalCount INTEGER NOT NULL,
      maleCount INTEGER,
      femaleCount INTEGER,
      juvenileCount INTEGER,
      campId TEXT,
      notes TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameHuntRecord',
    sql: `CREATE TABLE IF NOT EXISTS "GameHuntRecord" (
      id TEXT PRIMARY KEY NOT NULL,
      huntType TEXT NOT NULL,
      startDate TEXT NOT NULL,
      endDate TEXT NOT NULL,
      clientName TEXT NOT NULL,
      clientNationality TEXT,
      clientEmail TEXT,
      clientPhone TEXT,
      outfitterName TEXT,
      phName TEXT NOT NULL,
      phLicenseNumber TEXT,
      dayFeePerDay REAL,
      totalDayFees REAL,
      totalTrophyFees REAL,
      totalRevenue REAL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameHuntAnimal',
    sql: `CREATE TABLE IF NOT EXISTS "GameHuntAnimal" (
      id TEXT PRIMARY KEY NOT NULL,
      huntRecordId TEXT NOT NULL,
      speciesId TEXT NOT NULL,
      sex TEXT NOT NULL,
      ageClass TEXT NOT NULL,
      harvestDate TEXT NOT NULL,
      campId TEXT,
      gpsLat REAL,
      gpsLon REAL,
      caliber TEXT,
      trophyMeasurementRW REAL,
      trophyMeasurementSCI REAL,
      trophyNotes TEXT,
      trophyPhotoUrl TEXT,
      priceFeeRands REAL,
      bodyMassKg REAL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameOfftakeQuota',
    sql: `CREATE TABLE IF NOT EXISTS "GameOfftakeQuota" (
      id TEXT PRIMARY KEY NOT NULL,
      speciesId TEXT NOT NULL,
      season TEXT NOT NULL,
      seasonStart TEXT NOT NULL,
      seasonEnd TEXT NOT NULL,
      totalQuota INTEGER NOT NULL,
      maleQuota INTEGER,
      femaleQuota INTEGER,
      usedTotal INTEGER NOT NULL DEFAULT 0,
      usedMale INTEGER NOT NULL DEFAULT 0,
      usedFemale INTEGER NOT NULL DEFAULT 0,
      quotaType TEXT NOT NULL,
      notes TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameIntroduction',
    sql: `CREATE TABLE IF NOT EXISTS "GameIntroduction" (
      id TEXT PRIMARY KEY NOT NULL,
      speciesId TEXT NOT NULL,
      date TEXT NOT NULL,
      direction TEXT NOT NULL,
      count INTEGER NOT NULL,
      sex TEXT,
      sourceFarm TEXT,
      destinationFarm TEXT,
      costRands REAL,
      revenueRands REAL,
      transportPermit TEXT,
      notes TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GamePredationEvent',
    sql: `CREATE TABLE IF NOT EXISTS "GamePredationEvent" (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      predatorSpecies TEXT NOT NULL,
      preySpeciesId TEXT,
      preyCount INTEGER NOT NULL DEFAULT 1,
      preySex TEXT,
      campId TEXT,
      gpsLat REAL,
      gpsLon REAL,
      evidenceType TEXT NOT NULL,
      estimatedLossRands REAL,
      responseAction TEXT,
      notes TEXT,
      attachmentUrl TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameMortality',
    sql: `CREATE TABLE IF NOT EXISTS "GameMortality" (
      id TEXT PRIMARY KEY NOT NULL,
      speciesId TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      cause TEXT NOT NULL,
      sex TEXT,
      campId TEXT,
      estimatedLossRands REAL,
      veterinaryReport TEXT,
      notes TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameWaterPoint',
    sql: `CREATE TABLE IF NOT EXISTS "GameWaterPoint" (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      campId TEXT,
      gpsLat REAL,
      gpsLon REAL,
      depthMeters REAL,
      yieldLitersPerHour REAL,
      capacityLiters REAL,
      pumpType TEXT,
      status TEXT NOT NULL DEFAULT 'operational',
      lastInspected TEXT,
      notes TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameInfrastructure',
    sql: `CREATE TABLE IF NOT EXISTS "GameInfrastructure" (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      campId TEXT,
      gpsLat REAL,
      gpsLon REAL,
      lengthKm REAL,
      capacityAnimals INTEGER,
      condition TEXT NOT NULL DEFAULT 'good',
      lastMaintenanceDate TEXT,
      nextMaintenanceDate TEXT,
      maintenanceCostRands REAL,
      notes TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GamePermit',
    sql: `CREATE TABLE IF NOT EXISTS "GamePermit" (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      permitNumber TEXT,
      speciesId TEXT,
      issuedDate TEXT,
      expiryDate TEXT,
      issuingAuthority TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      quotaAllocated INTEGER,
      documentUrl TEXT,
      notes TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameVeldCondition',
    sql: `CREATE TABLE IF NOT EXISTS "GameVeldCondition" (
      id TEXT PRIMARY KEY NOT NULL,
      campId TEXT NOT NULL,
      date TEXT NOT NULL,
      assessor TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'grazing_index',
      grazingScore REAL,
      browseScore REAL,
      coverCategory TEXT,
      kgDmPerHa REAL,
      grassSpeciesComposition TEXT,
      bushEncroachment TEXT,
      erosionLevel TEXT,
      notes TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'GameRainfallRecord',
    sql: `CREATE TABLE IF NOT EXISTS "GameRainfallRecord" (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      rainfallMm REAL NOT NULL,
      stationName TEXT,
      campId TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
];

// All non-PK indices observed on delta-livestock, with IF NOT EXISTS added.
// PRIMARY KEY indices are auto-created with the table.
const CREATE_INDICES: ReadonlyArray<string> = [
  // Notification
  `CREATE INDEX IF NOT EXISTS "idx_notification_read_date" ON "Notification"("isRead", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "notification_collapse_idx" ON "Notification"("collapseKey")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "notification_dedup_idx" ON "Notification"("type", "dedupKey") WHERE "dedupKey" IS NOT NULL`,
  // PushSubscription
  `CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint")`,
  `CREATE INDEX IF NOT EXISTS "idx_push_user" ON "PushSubscription"("userEmail")`,
  // AlertPreference
  `CREATE UNIQUE INDEX IF NOT EXISTS "AlertPreference_unique_user_pref_idx" ON "AlertPreference"("userId", "category", "alertType", "channel", "speciesOverride")`,
  `CREATE INDEX IF NOT EXISTS "AlertPreference_userId_idx" ON "AlertPreference"("userId")`,
  // GameCensusEvent
  `CREATE INDEX IF NOT EXISTS "idx_game_census_date" ON "GameCensusEvent"(date)`,
  // GameCensusResult
  `CREATE INDEX IF NOT EXISTS "idx_census_result_event" ON "GameCensusResult"(censusEventId)`,
  `CREATE INDEX IF NOT EXISTS "idx_census_result_species" ON "GameCensusResult"(speciesId)`,
  // GameHuntRecord
  `CREATE INDEX IF NOT EXISTS "idx_hunt_start_date" ON "GameHuntRecord"(startDate)`,
  `CREATE INDEX IF NOT EXISTS "idx_hunt_type" ON "GameHuntRecord"(huntType)`,
  // GameHuntAnimal
  `CREATE INDEX IF NOT EXISTS "idx_hunt_animal_record" ON "GameHuntAnimal"(huntRecordId)`,
  `CREATE INDEX IF NOT EXISTS "idx_hunt_animal_species" ON "GameHuntAnimal"(speciesId)`,
  `CREATE INDEX IF NOT EXISTS "idx_hunt_animal_date" ON "GameHuntAnimal"(harvestDate)`,
  // GameOfftakeQuota
  `CREATE INDEX IF NOT EXISTS "idx_quota_species_season" ON "GameOfftakeQuota"(speciesId, season)`,
  // GameIntroduction
  `CREATE INDEX IF NOT EXISTS "idx_intro_species_date" ON "GameIntroduction"(speciesId, date)`,
  // GamePredationEvent
  `CREATE INDEX IF NOT EXISTS "idx_predation_date" ON "GamePredationEvent"(date)`,
  `CREATE INDEX IF NOT EXISTS "idx_predation_predator" ON "GamePredationEvent"(predatorSpecies)`,
  `CREATE INDEX IF NOT EXISTS "idx_predation_camp" ON "GamePredationEvent"(campId)`,
  // GameMortality
  `CREATE INDEX IF NOT EXISTS "idx_mortality_species_date" ON "GameMortality"(speciesId, date)`,
  `CREATE INDEX IF NOT EXISTS "idx_mortality_cause" ON "GameMortality"(cause)`,
  // GameWaterPoint
  `CREATE INDEX IF NOT EXISTS "idx_water_point_camp" ON "GameWaterPoint"(campId)`,
  `CREATE INDEX IF NOT EXISTS "idx_water_point_status" ON "GameWaterPoint"(status)`,
  // GameInfrastructure
  `CREATE INDEX IF NOT EXISTS "idx_infra_type" ON "GameInfrastructure"(type)`,
  `CREATE INDEX IF NOT EXISTS "idx_infra_condition" ON "GameInfrastructure"(condition)`,
  // GamePermit
  `CREATE INDEX IF NOT EXISTS "idx_permit_type_status" ON "GamePermit"(type, status)`,
  `CREATE INDEX IF NOT EXISTS "idx_permit_expiry" ON "GamePermit"(expiryDate)`,
  // GameVeldCondition
  `CREATE INDEX IF NOT EXISTS "idx_veld_camp_date" ON "GameVeldCondition"(campId, date)`,
  // GameRainfallRecord
  `CREATE INDEX IF NOT EXISTS "idx_rainfall_date" ON "GameRainfallRecord"(date)`,
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function tableExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  return res.rows.length > 0;
}

// ── Per-tenant migration ───────────────────────────────────────────────────

async function migrateOne(slug: string): Promise<void> {
  const creds = await getFarmCreds(slug);
  if (!creds) {
    console.warn(`  [${slug}] no creds, skipping`);
    return;
  }

  const db = createClient({
    url: creds.tursoUrl,
    authToken: creds.tursoAuthToken,
  });

  const created: string[] = [];
  const alreadyPresent: string[] = [];

  try {
    // Sanity guard: AlertPreference FK references User. If User is missing the
    // CREATE will succeed (SQLite defers FK validation) but inserts will later
    // fail. Surface this early.
    if (!(await tableExists(db, 'User'))) {
      throw new Error(
        `User table missing on tenant "${slug}" — base schema not provisioned. Run base provisioning first.`,
      );
    }

    for (const t of CREATE_TABLES) {
      const had = await tableExists(db, t.name);
      await db.execute(t.sql);
      if (had) {
        alreadyPresent.push(t.name);
      } else {
        created.push(t.name);
      }
    }

    for (const sql of CREATE_INDICES) {
      await db.execute(sql);
    }

    console.log(
      `  [${slug}] ok — created ${created.length} table(s): ${created.join(', ') || '(none)'}; ${alreadyPresent.length} already existed`,
    );
  } finally {
    db.close();
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `\n-- acme-cattle base-schema catchup (Notification + PushSubscription + FarmSpeciesSettings + AlertPreference + Game*) --\n`,
  );
  console.log(`Target tenant: ${TARGET_SLUG} (hard-coded — script will not run on any other slug)\n`);

  try {
    await migrateOne(TARGET_SLUG);
    console.log('\nDone. 1 tenant migrated. Next step: re-run scripts/migrate-alert-prefs.ts.');
  } catch (err) {
    console.error(`\n[${TARGET_SLUG}] FAILED:`, err);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
