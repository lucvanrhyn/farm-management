-- Phase I.3 — denormalise `species` onto Observation so `/admin/reproduction`
-- (and any other repro-analytics surface) can filter `species: mode` directly
-- instead of prefetching every animalId of the active species and pushing
-- `{ animalId: { in: [...874 ids...] } }` into every downstream query.
-- Wide IN-lists defeat index usage and re-transmit ~15KB per sub-query over
-- the Tokyo RTT.
--
-- Paired with prisma/schema.prisma Observation.species + @@index([species, animalId]).
-- The migrator (lib/migrator.ts) records applied names in `_migrations`, so
-- this file runs at most once per tenant. The CREATE INDEX uses IF NOT EXISTS
-- and the backfill uses a WHERE species IS NULL guard so the migration is
-- safe on tenants where an operator may have pre-created either manually.

ALTER TABLE "Observation" ADD COLUMN "species" TEXT;

UPDATE "Observation"
SET "species" = (
  SELECT "species" FROM "Animal" WHERE "Animal"."animalId" = "Observation"."animalId"
)
WHERE "species" IS NULL;

CREATE INDEX IF NOT EXISTS idx_observation_species_animal
  ON "Observation" ("species", "animalId");
