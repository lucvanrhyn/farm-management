-- 0023_farmsettings_parity.sql
--
-- Issue #280 (parent PRD #279) — FarmSettings schema-parity backfill.
-- DDL half of the pre-stamp split. See 0022_pre_stamp_farmsettings_parity.sql
-- for the incident writeup (PR #298 post-merge promote jam, 2026-05-16) and
-- why this file is renamed from 0022 and gated behind a pre-stamp. Tenants
-- that already have the columns (the legacy `prisma db push` cohort AND every
-- tenant provisioned from the post-#298 bootstrap DDL, which already declares
-- all 21) get this migration pre-stamped as applied and skip the ALTERs
-- entirely; only a genuinely column-less fresh DB ever runs the DDL below.
--
-- ROOT CAUSE (not symptom): 21 columns are declared on `model FarmSettings`
-- in `prisma/schema.prisma` but were NEVER created by the canonical tenant
-- bootstrap DDL (`lib/farm-schema.ts`) nor by any numbered migration. They
-- only ever materialised on tenant DBs that had been `prisma db push`-ed
-- (the forbidden path — see CLAUDE.md "do NOT run prisma db push"). The
-- #276 regression (commit 2653be5) added a
-- `prisma.farmSettings.findFirst()` to `getCachedDashboardOverview`; the
-- default Prisma SELECT lists the drifted `timezone` column, so on any
-- tenant without the drift the statement throws `no such column:
-- timezone` and the whole admin Overview aggregate zeroed ("0/9",
-- "0/19"). This file closes the drift class for every existing tenant;
-- the matching bootstrap-DDL change gives newly provisioned tenants
-- parity from creation.
--
-- Discipline notes (mirror 0021_death_carcass_disposal.sql):
--   * Additive only — pure `ALTER TABLE … ADD COLUMN` on FarmSettings.
--     No DROP/RENAME, no User/_migrations touch → within promote scope.
--   * Idempotency is provided by the migrator's per-tenant `_migrations`
--     bookkeeping table (`lib/migrator.ts`): each file runs exactly once
--     per tenant DB inside an atomic batch. SQLite/libSQL has no
--     `ADD COLUMN IF NOT EXISTS`; re-running this file is prevented by the
--     bookkeeping row, not by per-statement guards. Every column added
--     here is absent on every tenant that has NOT been db-push-drifted
--     (the bootstrap shipped these tenants without the columns), so the
--     batch applies cleanly.
--   * Defaults mirror the Prisma `@default(...)` declarations EXACTLY so
--     the `checkPrismaColumnParity` gate (#137) and the Prisma client
--     agree with the live DB. All defaults are constant literals (no
--     `CURRENT_TIMESTAMP`) — the wave/132 silent-reject failure mode does
--     not apply; `ADD COLUMN NOT NULL DEFAULT <const>` is fully supported.
--   * `verifyMigrationApplied` (#141) parses each ALTER and probes
--     pragma_table_info; on a silent libSQL miss the bookkeeping row is
--     rolled back so the file re-runs next batch.
--   * Identifier quoting per feedback-quote-sql-keywords-in-migrations.md
--     (none of these are SQL keywords, but the project convention is to
--     double-quote table/column identifiers in hand-written migrations).

-- Rotation planner defaults (Prisma: Int/Float/String NOT NULL @default)
ALTER TABLE "FarmSettings" ADD COLUMN "defaultRestDays" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "FarmSettings" ADD COLUMN "defaultMaxGrazingDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "FarmSettings" ADD COLUMN "rotationSeasonMode" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "FarmSettings" ADD COLUMN "dormantSeasonMultiplier" REAL NOT NULL DEFAULT 1.4;

-- NVD seller identity fields (Prisma: String? — nullable)
ALTER TABLE "FarmSettings" ADD COLUMN "ownerName" TEXT;
ALTER TABLE "FarmSettings" ADD COLUMN "ownerIdNumber" TEXT;
ALTER TABLE "FarmSettings" ADD COLUMN "physicalAddress" TEXT;
ALTER TABLE "FarmSettings" ADD COLUMN "postalAddress" TEXT;
ALTER TABLE "FarmSettings" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "FarmSettings" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "FarmSettings" ADD COLUMN "propertyRegNumber" TEXT;
ALTER TABLE "FarmSettings" ADD COLUMN "farmRegion" TEXT;
ALTER TABLE "FarmSettings" ADD COLUMN "biomeType" TEXT;

-- Onboarding state (Prisma: Boolean NOT NULL @default(false))
ALTER TABLE "FarmSettings" ADD COLUMN "onboardingComplete" BOOLEAN NOT NULL DEFAULT false;

-- Notification preferences — Phase J (Prisma: String? with literal defaults)
ALTER TABLE "FarmSettings" ADD COLUMN "quietHoursStart" TEXT DEFAULT '20:00';
ALTER TABLE "FarmSettings" ADD COLUMN "quietHoursEnd" TEXT DEFAULT '06:00';
ALTER TABLE "FarmSettings" ADD COLUMN "timezone" TEXT DEFAULT 'Africa/Johannesburg';
ALTER TABLE "FarmSettings" ADD COLUMN "speciesAlertThresholds" TEXT;

-- Phase K / L admin preference blobs (Prisma: String? JSON, nullable)
ALTER TABLE "FarmSettings" ADD COLUMN "taskSettings" TEXT;
ALTER TABLE "FarmSettings" ADD COLUMN "mapSettings" TEXT;
ALTER TABLE "FarmSettings" ADD COLUMN "aiSettings" TEXT;
