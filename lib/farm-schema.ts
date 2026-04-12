/**
 * SQL schema for new per-farm databases.
 * Generated from prisma/schema.prisma via:
 *   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
 *
 * IMPORTANT: Regenerate this file after any Prisma schema change using:
 *   pnpm db:gen-schema
 */
export const FARM_SCHEMA_SQL = `
-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "campId" TEXT NOT NULL,
    "animalId" TEXT,
    "details" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loggedBy" TEXT,
    "editedBy" TEXT,
    "editedAt" DATETIME,
    "editHistory" TEXT,
    "attachmentUrl" TEXT
);

-- CreateTable
CREATE TABLE "Animal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "animalId" TEXT NOT NULL,
    "name" TEXT,
    "sex" TEXT NOT NULL,
    "dateOfBirth" TEXT,
    "breed" TEXT NOT NULL DEFAULT 'Brangus',
    "category" TEXT NOT NULL,
    "currentCamp" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "motherId" TEXT,
    "fatherId" TEXT,
    "mobId" TEXT,
    "registrationNumber" TEXT,
    "dateAdded" TEXT NOT NULL,
    "deceasedAt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "species" TEXT NOT NULL DEFAULT 'cattle',
    "speciesData" TEXT
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "animalId" TEXT,
    "campId" TEXT,
    "reference" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saleType" TEXT,
    "counterparty" TEXT,
    "quantity" INTEGER,
    "avgMassKg" REAL,
    "fees" REAL,
    "transportCost" REAL,
    "animalIds" TEXT
);

-- CreateTable
CREATE TABLE "TransactionCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FarmSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "alertThresholdHours" INTEGER NOT NULL DEFAULT 48,
    "farmName" TEXT NOT NULL DEFAULT 'My Farm',
    "breed" TEXT NOT NULL DEFAULT 'Mixed',
    "updatedAt" DATETIME NOT NULL,
    "updatedBy" TEXT,
    "adgPoorDoerThreshold" REAL NOT NULL DEFAULT 0.7,
    "calvingAlertDays" INTEGER NOT NULL DEFAULT 14,
    "daysOpenLimit" INTEGER NOT NULL DEFAULT 365,
    "campGrazingWarningDays" INTEGER NOT NULL DEFAULT 7,
    "latitude" REAL,
    "longitude" REAL,
    "targetStockingRate" REAL,
    "breedingSeasonStart" TEXT,
    "breedingSeasonEnd" TEXT,
    "weaningDate" TEXT,
    "openaiApiKey" TEXT,
    "heroImageUrl" TEXT DEFAULT '/farm-hero.jpg'
);

-- CreateTable
CREATE TABLE "Camp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campId" TEXT NOT NULL,
    "campName" TEXT NOT NULL,
    "sizeHectares" REAL,
    "waterSource" TEXT,
    "geojson" TEXT,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CampCoverReading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campId" TEXT NOT NULL,
    "coverCategory" TEXT NOT NULL,
    "kgDmPerHa" REAL NOT NULL,
    "useFactor" REAL NOT NULL DEFAULT 0.35,
    "recordedAt" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Mob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "currentCamp" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "campId" TEXT,
    "animalId" TEXT,
    "assignedTo" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "completedAt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FarmSpeciesSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "species" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "gestationDays" INTEGER,
    "voluntaryWaitingDays" INTEGER,
    "breedingSeasonStart" TEXT,
    "breedingSeasonEnd" TEXT,
    "weaningAgeDays" INTEGER,
    "targetStockingRate" REAL,
    "customLsuValues" TEXT,
    "customCategories" TEXT,
    "quotaConfig" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GameSpecies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "commonName" TEXT NOT NULL,
    "scientificName" TEXT,
    "dietaryClass" TEXT NOT NULL,
    "lsuEquivalent" REAL NOT NULL,
    "averageMassKg" REAL,
    "isTops" BOOLEAN NOT NULL DEFAULT false,
    "defaultMortalityRate" REAL NOT NULL DEFAULT 0.05,
    "defaultRecruitmentRate" REAL NOT NULL DEFAULT 0.30,
    "gestationDays" INTEGER,
    "trophyMinRW" REAL,
    "trophyMinSCI" REAL,
    "targetPopulation" INTEGER,
    "currentEstimate" INTEGER NOT NULL DEFAULT 0,
    "lastCensusDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameCensusEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "observer" TEXT NOT NULL,
    "conditions" TEXT,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'moderate',
    "marginOfError" REAL,
    "costRands" REAL,
    "notes" TEXT,
    "areaHectares" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameCensusResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "censusEventId" TEXT NOT NULL,
    "speciesId" TEXT NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "maleCount" INTEGER,
    "femaleCount" INTEGER,
    "juvenileCount" INTEGER,
    "campId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameHuntRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "huntType" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientNationality" TEXT,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "outfitterName" TEXT,
    "phName" TEXT NOT NULL,
    "phLicenseNumber" TEXT,
    "dayFeePerDay" REAL,
    "totalDayFees" REAL,
    "totalTrophyFees" REAL,
    "totalRevenue" REAL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameHuntAnimal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "huntRecordId" TEXT NOT NULL,
    "speciesId" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "ageClass" TEXT NOT NULL,
    "harvestDate" TEXT NOT NULL,
    "campId" TEXT,
    "gpsLat" REAL,
    "gpsLon" REAL,
    "caliber" TEXT,
    "trophyMeasurementRW" REAL,
    "trophyMeasurementSCI" REAL,
    "trophyNotes" TEXT,
    "trophyPhotoUrl" TEXT,
    "priceFeeRands" REAL,
    "bodyMassKg" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameOfftakeQuota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "speciesId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "seasonStart" TEXT NOT NULL,
    "seasonEnd" TEXT NOT NULL,
    "totalQuota" INTEGER NOT NULL,
    "maleQuota" INTEGER,
    "femaleQuota" INTEGER,
    "usedTotal" INTEGER NOT NULL DEFAULT 0,
    "usedMale" INTEGER NOT NULL DEFAULT 0,
    "usedFemale" INTEGER NOT NULL DEFAULT 0,
    "quotaType" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameIntroduction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "speciesId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "sex" TEXT,
    "sourceFarm" TEXT,
    "destinationFarm" TEXT,
    "costRands" REAL,
    "revenueRands" REAL,
    "transportPermit" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GamePredationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "predatorSpecies" TEXT NOT NULL,
    "preySpeciesId" TEXT,
    "preyCount" INTEGER NOT NULL DEFAULT 1,
    "preySex" TEXT,
    "campId" TEXT,
    "gpsLat" REAL,
    "gpsLon" REAL,
    "evidenceType" TEXT NOT NULL,
    "estimatedLossRands" REAL,
    "responseAction" TEXT,
    "notes" TEXT,
    "attachmentUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameMortality" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "speciesId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "cause" TEXT NOT NULL,
    "sex" TEXT,
    "campId" TEXT,
    "estimatedLossRands" REAL,
    "veterinaryReport" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameWaterPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "campId" TEXT,
    "gpsLat" REAL,
    "gpsLon" REAL,
    "depthMeters" REAL,
    "yieldLitersPerHour" REAL,
    "capacityLiters" REAL,
    "pumpType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'operational',
    "lastInspected" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameInfrastructure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campId" TEXT,
    "gpsLat" REAL,
    "gpsLon" REAL,
    "lengthKm" REAL,
    "capacityAnimals" INTEGER,
    "condition" TEXT NOT NULL DEFAULT 'good',
    "lastMaintenanceDate" TEXT,
    "nextMaintenanceDate" TEXT,
    "maintenanceCostRands" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GamePermit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "permitNumber" TEXT,
    "speciesId" TEXT,
    "issuedDate" TEXT,
    "expiryDate" TEXT,
    "issuingAuthority" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "quotaAllocated" INTEGER,
    "documentUrl" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameVeldCondition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "assessor" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'grazing_index',
    "grazingScore" REAL,
    "browseScore" REAL,
    "coverCategory" TEXT,
    "kgDmPerHa" REAL,
    "grassSpeciesComposition" TEXT,
    "bushEncroachment" TEXT,
    "erosionLevel" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameRainfallRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "rainfallMm" REAL NOT NULL,
    "stationName" TEXT,
    "campId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "categoryName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "idx_obs_type_camp_date" ON "Observation"("type", "campId", "observedAt");

-- CreateIndex
CREATE INDEX "idx_obs_type_animal_date" ON "Observation"("type", "animalId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Animal_animalId_key" ON "Animal"("animalId");

-- CreateIndex
CREATE INDEX "idx_animal_camp_status" ON "Animal"("currentCamp", "status");

-- CreateIndex
CREATE INDEX "idx_animal_status" ON "Animal"("status");

-- CreateIndex
CREATE INDEX "idx_animal_species_status" ON "Animal"("species", "status");

-- CreateIndex
CREATE INDEX "idx_animal_species_camp_status" ON "Animal"("species", "currentCamp", "status");

-- CreateIndex
CREATE INDEX "idx_transaction_date" ON "Transaction"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Camp_campId_key" ON "Camp"("campId");

-- CreateIndex
CREATE INDEX "idx_cover_camp_date" ON "CampCoverReading"("campId", "recordedAt");

-- CreateIndex
CREATE INDEX "idx_mob_camp" ON "Mob"("currentCamp");

-- CreateIndex
CREATE INDEX "idx_task_assignee_status_date" ON "Task"("assignedTo", "status", "dueDate");

-- CreateIndex
CREATE INDEX "idx_task_date_status" ON "Task"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FarmSpeciesSettings_species_key" ON "FarmSpeciesSettings"("species");

-- CreateIndex
CREATE UNIQUE INDEX "GameSpecies_commonName_key" ON "GameSpecies"("commonName");

-- CreateIndex
CREATE INDEX "idx_game_census_date" ON "GameCensusEvent"("date");

-- CreateIndex
CREATE INDEX "idx_census_result_event" ON "GameCensusResult"("censusEventId");

-- CreateIndex
CREATE INDEX "idx_census_result_species" ON "GameCensusResult"("speciesId");

-- CreateIndex
CREATE INDEX "idx_hunt_start_date" ON "GameHuntRecord"("startDate");

-- CreateIndex
CREATE INDEX "idx_hunt_type" ON "GameHuntRecord"("huntType");

-- CreateIndex
CREATE INDEX "idx_hunt_animal_record" ON "GameHuntAnimal"("huntRecordId");

-- CreateIndex
CREATE INDEX "idx_hunt_animal_species" ON "GameHuntAnimal"("speciesId");

-- CreateIndex
CREATE INDEX "idx_hunt_animal_date" ON "GameHuntAnimal"("harvestDate");

-- CreateIndex
CREATE INDEX "idx_quota_species_season" ON "GameOfftakeQuota"("speciesId", "season");

-- CreateIndex
CREATE INDEX "idx_intro_species_date" ON "GameIntroduction"("speciesId", "date");

-- CreateIndex
CREATE INDEX "idx_predation_date" ON "GamePredationEvent"("date");

-- CreateIndex
CREATE INDEX "idx_predation_predator" ON "GamePredationEvent"("predatorSpecies");

-- CreateIndex
CREATE INDEX "idx_predation_camp" ON "GamePredationEvent"("campId");

-- CreateIndex
CREATE INDEX "idx_mortality_species_date" ON "GameMortality"("speciesId", "date");

-- CreateIndex
CREATE INDEX "idx_mortality_cause" ON "GameMortality"("cause");

-- CreateIndex
CREATE INDEX "idx_water_point_camp" ON "GameWaterPoint"("campId");

-- CreateIndex
CREATE INDEX "idx_water_point_status" ON "GameWaterPoint"("status");

-- CreateIndex
CREATE INDEX "idx_infra_type" ON "GameInfrastructure"("type");

-- CreateIndex
CREATE INDEX "idx_infra_condition" ON "GameInfrastructure"("condition");

-- CreateIndex
CREATE INDEX "idx_permit_type_status" ON "GamePermit"("type", "status");

-- CreateIndex
CREATE INDEX "idx_permit_expiry" ON "GamePermit"("expiryDate");

-- CreateIndex
CREATE INDEX "idx_veld_camp_date" ON "GameVeldCondition"("campId", "date");

-- CreateIndex
CREATE INDEX "idx_rainfall_date" ON "GameRainfallRecord"("date");

-- CreateIndex
CREATE INDEX "idx_notification_read_date" ON "Notification"("isRead", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "idx_push_user" ON "PushSubscription"("userEmail");

-- CreateIndex
CREATE UNIQUE INDEX "budget_year_month_category" ON "Budget"("year", "month", "categoryName");

-- CreateIndex
CREATE INDEX "idx_budget_period" ON "Budget"("year", "month");
`;
