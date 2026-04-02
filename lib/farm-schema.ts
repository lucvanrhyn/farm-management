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
    "notes" TEXT,
    "dateAdded" TEXT NOT NULL,
    "deceasedAt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "vaccinationCalendarNotes" TEXT,
    "openaiApiKey" TEXT
);

-- CreateTable
CREATE TABLE "Camp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campId" TEXT NOT NULL,
    "campName" TEXT NOT NULL,
    "sizeHectares" REAL,
    "waterSource" TEXT,
    "geojson" TEXT,
    "notes" TEXT,
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
    "recordedBy" TEXT NOT NULL,
    "notes" TEXT
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
CREATE INDEX "idx_transaction_date" ON "Transaction"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Camp_campId_key" ON "Camp"("campId");

-- CreateIndex
CREATE INDEX "idx_cover_camp_date" ON "CampCoverReading"("campId", "recordedAt");

-- CreateIndex
CREATE INDEX "idx_task_assignee_status_date" ON "Task"("assignedTo", "status", "dueDate");

-- CreateIndex
CREATE INDEX "idx_task_date_status" ON "Task"("dueDate", "status");
`;
