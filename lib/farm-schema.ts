/**
 * SQL schema for new per-farm databases.
 *
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 * Regenerate after any prisma/schema.prisma change with:
 *   pnpm db:gen-schema
 * CI fails if this file is stale: pnpm db:gen-schema:check
 *
 * Source of truth: prisma/schema.prisma, via
 *   prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
 *
 * Intentionally omitted (operator-provisioned, libSQL-specific DDL Prisma
 * can't express): EinsteinChunk — see scripts/gen-farm-schema.ts EXCLUDE_TABLES
 * and scripts/migrate-phase-l-einstein.ts.
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
    "attachmentUrl" TEXT,
    "species" TEXT,
    "clientLocalId" TEXT,
    "carcassDisposal" TEXT,
    "notes" TEXT
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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "species" TEXT NOT NULL DEFAULT 'cattle',
    "speciesData" TEXT,
    "sireNote" TEXT,
    "damNote" TEXT,
    "importJobId" TEXT,
    "tagNumber" TEXT,
    "brandSequence" TEXT,
    "clientLocalId" TEXT,
    CONSTRAINT "Animal_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "animalIds" TEXT,
    "isForeign" BOOLEAN DEFAULT false
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
    "defaultRestDays" INTEGER NOT NULL DEFAULT 60,
    "defaultMaxGrazingDays" INTEGER NOT NULL DEFAULT 7,
    "rotationSeasonMode" TEXT NOT NULL DEFAULT 'auto',
    "dormantSeasonMultiplier" REAL NOT NULL DEFAULT 1.4,
    "latitude" REAL,
    "longitude" REAL,
    "targetStockingRate" REAL,
    "breedingSeasonStart" TEXT,
    "breedingSeasonEnd" TEXT,
    "weaningDate" TEXT,
    "openaiApiKey" TEXT,
    "heroImageUrl" TEXT DEFAULT '/farm-hero.jpg',
    "ownerName" TEXT,
    "ownerIdNumber" TEXT,
    "taxReferenceNumber" TEXT,
    "physicalAddress" TEXT,
    "postalAddress" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "propertyRegNumber" TEXT,
    "aiaIdentificationMark" TEXT,
    "farmRegion" TEXT,
    "biomeType" TEXT,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" TEXT DEFAULT '20:00',
    "quietHoursEnd" TEXT DEFAULT '06:00',
    "timezone" TEXT DEFAULT 'Africa/Johannesburg',
    "speciesAlertThresholds" TEXT,
    "taskSettings" TEXT,
    "mapSettings" TEXT,
    "aiSettings" TEXT
);

-- CreateTable
CREATE TABLE "NvdRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nvdNumber" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saleDate" TEXT NOT NULL,
    "transactionId" TEXT,
    "buyerName" TEXT NOT NULL,
    "buyerAddress" TEXT,
    "buyerContact" TEXT,
    "destinationAddress" TEXT,
    "animalIds" TEXT NOT NULL,
    "animalSnapshot" TEXT NOT NULL,
    "sellerSnapshot" TEXT NOT NULL,
    "declarationsJson" TEXT NOT NULL,
    "transportJson" TEXT,
    "generatedBy" TEXT,
    "pdfHash" TEXT,
    "voidedAt" DATETIME,
    "voidReason" TEXT
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "species" TEXT NOT NULL DEFAULT 'cattle',
    "veldType" TEXT,
    "restDaysOverride" INTEGER,
    "maxGrazingDaysOverride" INTEGER,
    "rotationNotes" TEXT
);

-- CreateTable
CREATE TABLE "CampCoverReading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campId" TEXT NOT NULL,
    "coverCategory" TEXT NOT NULL,
    "kgDmPerHa" REAL NOT NULL,
    "useFactor" REAL NOT NULL DEFAULT 0.35,
    "recordedAt" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "clientLocalId" TEXT
);

-- CreateTable
CREATE TABLE "Mob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "currentCamp" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "species" TEXT NOT NULL DEFAULT 'cattle'
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskType" TEXT,
    "lat" REAL,
    "lng" REAL,
    "recurrenceRule" TEXT,
    "reminderOffset" INTEGER,
    "assigneeIds" TEXT,
    "templateId" TEXT,
    "blockedByIds" TEXT,
    "completedObservationId" TEXT,
    "recurrenceSource" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_af" TEXT,
    "taskType" TEXT NOT NULL,
    "description" TEXT,
    "description_af" TEXT,
    "priorityDefault" TEXT,
    "recurrenceRule" TEXT,
    "reminderOffset" INTEGER,
    "species" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaskOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "occurrenceAt" DATETIME NOT NULL,
    "reminderAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" DATETIME,
    "reminderDispatchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskOccurrence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE TABLE "VeldAssessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campId" TEXT NOT NULL,
    "assessmentDate" TEXT NOT NULL,
    "assessor" TEXT NOT NULL,
    "palatableSpeciesPct" REAL NOT NULL,
    "bareGroundPct" REAL NOT NULL,
    "erosionLevel" INTEGER NOT NULL,
    "bushEncroachmentLevel" INTEGER NOT NULL,
    "veldScore" REAL NOT NULL,
    "biomeAtAssessment" TEXT,
    "haPerLsu" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT
);

-- CreateTable
CREATE TABLE "GameRainfallRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "rainfallMm" REAL NOT NULL,
    "stationName" TEXT,
    "campId" TEXT,
    "lat" REAL,
    "lng" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RainfallNormal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "monthIdx" INTEGER NOT NULL,
    "meanMm" REAL NOT NULL,
    "stdDevMm" REAL NOT NULL,
    "sampleYears" INTEGER NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "It3Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taxYear" INTEGER NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "generatedBy" TEXT,
    "pdfHash" TEXT,
    "voidedAt" DATETIME,
    "voidReason" TEXT
);

-- CreateTable
CREATE TABLE "SarsLivestockElection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "species" TEXT NOT NULL,
    "ageCategory" TEXT NOT NULL,
    "electedValueZar" INTEGER NOT NULL,
    "electedYear" INTEGER NOT NULL,
    "sarsChangeApprovalRef" TEXT,
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
    "expiresAt" DATETIME NOT NULL,
    "dedupKey" TEXT,
    "payload" TEXT,
    "collapseKey" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "pushDispatchedAt" DATETIME,
    "digestDispatchedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AlertPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "alertType" TEXT,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "digestMode" TEXT NOT NULL DEFAULT 'realtime',
    "speciesOverride" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AlertPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE TABLE "PayfastEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pfPaymentId" TEXT NOT NULL,
    "eventTime" DATETIME NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME
);

-- CreateTable
CREATE TABLE "RotationPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RotationPlanStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "campId" TEXT NOT NULL,
    "mobId" TEXT,
    "plannedStart" DATETIME NOT NULL,
    "plannedDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actualStart" DATETIME,
    "actualEnd" DATETIME,
    "executedObservationId" TEXT,
    "notes" TEXT,
    CONSTRAINT "RotationPlanStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RotationPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "farmId" TEXT NOT NULL,
    "sourceFileHash" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "mappingJson" TEXT NOT NULL,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedTokens" INTEGER,
    "costZar" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedBy" TEXT NOT NULL,
    "status" TEXT,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "farmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RagQueryLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "assistantName" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answerText" TEXT,
    "citations" TEXT NOT NULL,
    "retrievalLatencyMs" INTEGER NOT NULL,
    "answerLatencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "costZar" REAL NOT NULL,
    "modelId" TEXT NOT NULL,
    "feedback" TEXT,
    "feedbackNote" TEXT,
    "errorCode" TEXT,
    "refusedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_clientLocalId_key" ON "Observation"("clientLocalId");

-- CreateIndex
CREATE INDEX "idx_obs_type_camp_date" ON "Observation"("type", "campId", "observedAt");

-- CreateIndex
CREATE INDEX "idx_obs_type_animal_date" ON "Observation"("type", "animalId", "observedAt");

-- CreateIndex
CREATE INDEX "idx_obs_camp" ON "Observation"("campId");

-- CreateIndex
CREATE INDEX "idx_obs_animal" ON "Observation"("animalId");

-- CreateIndex
CREATE INDEX "idx_obs_logged_by" ON "Observation"("loggedBy");

-- CreateIndex
CREATE INDEX "idx_observation_species_animal" ON "Observation"("species", "animalId");

-- CreateIndex
CREATE UNIQUE INDEX "Animal_animalId_key" ON "Animal"("animalId");

-- CreateIndex
CREATE UNIQUE INDEX "Animal_clientLocalId_key" ON "Animal"("clientLocalId");

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
CREATE INDEX "idx_transaction_animal" ON "Transaction"("animalId");

-- CreateIndex
CREATE INDEX "idx_transaction_camp" ON "Transaction"("campId");

-- CreateIndex
CREATE UNIQUE INDEX "NvdRecord_nvdNumber_key" ON "NvdRecord"("nvdNumber");

-- CreateIndex
CREATE INDEX "idx_nvd_issued_at" ON "NvdRecord"("issuedAt");

-- CreateIndex
CREATE INDEX "idx_nvd_transaction" ON "NvdRecord"("transactionId");

-- CreateIndex
CREATE INDEX "Camp_species_idx" ON "Camp"("species");

-- CreateIndex
CREATE UNIQUE INDEX "Camp_species_campId_key" ON "Camp"("species", "campId");

-- CreateIndex
CREATE UNIQUE INDEX "CampCoverReading_clientLocalId_key" ON "CampCoverReading"("clientLocalId");

-- CreateIndex
CREATE INDEX "idx_cover_camp_date" ON "CampCoverReading"("campId", "recordedAt");

-- CreateIndex
CREATE INDEX "idx_mob_camp" ON "Mob"("currentCamp");

-- CreateIndex
CREATE INDEX "Mob_species_idx" ON "Mob"("species");

-- CreateIndex
CREATE INDEX "idx_task_assignee_status_date" ON "Task"("assignedTo", "status", "dueDate");

-- CreateIndex
CREATE INDEX "idx_task_date_status" ON "Task"("dueDate", "status");

-- CreateIndex
CREATE INDEX "idx_task_type" ON "Task"("taskType");

-- CreateIndex
CREATE INDEX "idx_task_template" ON "Task"("templateId");

-- CreateIndex
CREATE INDEX "idx_task_template_tenant_type" ON "TaskTemplate"("tenantSlug", "taskType");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTemplate_tenantSlug_name_key" ON "TaskTemplate"("tenantSlug", "name");

-- CreateIndex
CREATE INDEX "idx_task_occurrence_reminder" ON "TaskOccurrence"("reminderAt", "reminderDispatchedAt");

-- CreateIndex
CREATE INDEX "idx_task_occurrence_at_status" ON "TaskOccurrence"("occurrenceAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskOccurrence_taskId_occurrenceAt_key" ON "TaskOccurrence"("taskId", "occurrenceAt");

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
CREATE INDEX "idx_veld_assessment_camp_date" ON "VeldAssessment"("campId", "assessmentDate");

-- CreateIndex
CREATE INDEX "idx_veld_assessment_date" ON "VeldAssessment"("assessmentDate");

-- CreateIndex
CREATE INDEX "idx_rainfall_date" ON "GameRainfallRecord"("date");

-- CreateIndex
CREATE INDEX "idx_rain_norm_latlng" ON "RainfallNormal"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "RainfallNormal_latitude_longitude_monthIdx_key" ON "RainfallNormal"("latitude", "longitude", "monthIdx");

-- CreateIndex
CREATE INDEX "idx_it3_tax_year" ON "It3Snapshot"("taxYear");

-- CreateIndex
CREATE INDEX "idx_it3_issued_at" ON "It3Snapshot"("issuedAt");

-- CreateIndex
CREATE INDEX "SarsLivestockElection_class_idx" ON "SarsLivestockElection"("species", "ageCategory");

-- CreateIndex
CREATE UNIQUE INDEX "SarsLivestockElection_species_ageCategory_electedYear_key" ON "SarsLivestockElection"("species", "ageCategory", "electedYear");

-- CreateIndex
CREATE INDEX "idx_notification_read_date" ON "Notification"("isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_collapseKey_idx" ON "Notification"("collapseKey");

-- CreateIndex
CREATE INDEX "idx_notification_expires_read_created" ON "Notification"("expiresAt", "isRead", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_type_dedupKey_key" ON "Notification"("type", "dedupKey");

-- CreateIndex
CREATE INDEX "AlertPreference_userId_idx" ON "AlertPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertPreference_userId_category_alertType_channel_speciesOverride_key" ON "AlertPreference"("userId", "category", "alertType", "channel", "speciesOverride");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "idx_push_user" ON "PushSubscription"("userEmail");

-- CreateIndex
CREATE UNIQUE INDEX "payfast_events_pf_payment_id_idx" ON "PayfastEvent"("pfPaymentId");

-- CreateIndex
CREATE INDEX "payfast_events_event_time_idx" ON "PayfastEvent"("eventTime");

-- CreateIndex
CREATE INDEX "payfast_events_applied_at_idx" ON "PayfastEvent"("appliedAt");

-- CreateIndex
CREATE INDEX "idx_plan_step_plan_seq" ON "RotationPlanStep"("planId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "RotationPlanStep_planId_sequence_key" ON "RotationPlanStep"("planId", "sequence");

-- CreateIndex
CREATE INDEX "idx_budget_period" ON "Budget"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_year_month_categoryName_key" ON "Budget"("year", "month", "categoryName");

-- CreateIndex
CREATE INDEX "ImportJob_farmId_createdAt_idx" ON "ImportJob"("farmId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_farmId_appliesTo_name_key" ON "CustomField"("farmId", "appliesTo", "name");

-- CreateIndex
CREATE INDEX "idx_rag_query_user_date" ON "RagQueryLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_rag_query_date" ON "RagQueryLog"("createdAt");
`;

/**
 * Every numbered migration under migrations/ as of generation time. The schema
 * above already reflects all of their effects, so a freshly provisioned tenant
 * must have these stamped as applied in `_migrations` (see lib/seed-farm-db.ts):
 * otherwise `pnpm db:migrate` would try to re-apply them and fail on an
 * already-existing column or table.
 */
export const BASELINE_MIGRATION_NAMES: readonly string[] = [
  '0001_camp_cover_reading_attachment_url.sql',
  '0002_notification_expires_index.sql',
  '0003_add_species_to_observation.sql',
  '0004_nvd_transport.sql',
  '0007_transaction_is_foreign.sql',
  '0008_record_legacy_renames.sql',
  '0009_camp_mob_species.sql',
  '0010_sars_livestock_election.sql',
  '0011_aia_tag_fields.sql',
  '0012_farmsettings_tax_ref_number.sql',
  '0013_payfast_events.sql',
  '0014_einstein_chunker_version.sql',
  '0015_payfast_events_applied_at.sql',
  '0016_pre_stamp_animal_species_columns.sql',
  '0017_animal_species_columns.sql',
  '0018_it3_snapshot.sql',
  '0019_observation_idempotency.sql',
  '0020_animal_cover_idempotency.sql',
  '0021_death_carcass_disposal.sql',
  '0022_pre_stamp_farmsettings_parity.sql',
  '0023_farmsettings_parity.sql',
  '0024_backfill_observation_species_stragglers.sql',
  '0025_backfill_empty_camp_color.sql',
  '0026_observation_notes.sql',
];
