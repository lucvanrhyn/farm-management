-- ADR-0006 / ADR-0004 §5 closure — backfill NULL-species Observation
-- stragglers accumulated since migration 0003's column-add backfill.
--
-- Context
-- -------
-- Migration 0003 added `Observation.species` and backfilled rows that
-- carried an animalId. Between 0003 and ADR-0006, three call sites
-- bypassed `createObservation` and produced NULL-species rows:
--   - app/api/animals/[id]/photos/route.ts (camp_check, animal-bound;
--     mostly stamped species correctly but bypassed the door)
--   - lib/domain/tasks/update-task.ts (task-completion observations;
--     stamped species via inline animal lookup)
--   - lib/domain/mobs/move-mob.ts — the load-bearing leak: BOTH
--     mob_movement rows (source + dest) never set species at all.
--     Every mob movement since the column landed produced two
--     NULL-species rows on Observation_species_observedAt_idx.
--
-- This migration replays the ADR-0006 waterfall in SQL so the read
-- side can drop its NULL-tolerant predicate (ADR-0004 §5) without
-- silently dropping pre-ADR-0006 rows from per-species queries:
--   1. Animal lookup via animalId (covers task-completion rows + any
--      stragglers the 0003 backfill missed).
--   2. Mob lookup via the mob-movement details JSON (the mob_movement
--      rows carry the mob's id inside `details` as JSON — see
--      lib/domain/mobs/move-mob.ts. We recover it via json_extract.
--   3. Camp lookup via campId for any remaining rows whose camp
--      carries a non-null species (post-#28 Phase A migration most
--      camps carry one).
--
-- The migrator (lib/migrator.ts) records applied names in
-- `_migrations`, so this runs at most once per tenant. Idempotent by
-- design: every step is guarded by `WHERE species IS NULL`.

-- Step 1 — animal-bound stragglers.
UPDATE "Observation"
SET "species" = (
  SELECT "species" FROM "Animal"
  WHERE "Animal"."animalId" = "Observation"."animalId"
)
WHERE "species" IS NULL
  AND "animalId" IS NOT NULL;

-- Step 2 — mob_movement rows. The `details` column is the JSON.stringify
-- of { mobId, mobName, sourceCamp, destCamp, animalCount, animalIds }
-- that move-mob.ts writes (see sharedDetails in performMobMove). We
-- read mobId via json_extract and look up the mob's species. SQLite's
-- json_extract returns NULL when the path is missing — the JOIN then
-- yields no row and the UPDATE is a no-op for that observation.
UPDATE "Observation"
SET "species" = (
  SELECT "Mob"."species" FROM "Mob"
  WHERE "Mob"."id" = json_extract("Observation"."details", '$.mobId')
)
WHERE "species" IS NULL
  AND "type" = 'mob_movement';

-- Step 3 — camp-bound stragglers (any remaining row whose resolved
-- camp carries a species). Post-#28 Phase A every camp has a non-null
-- species, so this catches the legacy camp-only observation tail.
UPDATE "Observation"
SET "species" = (
  SELECT "species" FROM "Camp"
  WHERE "Camp"."campId" = "Observation"."campId"
    AND "Camp"."species" IS NOT NULL
  LIMIT 1
)
WHERE "species" IS NULL;
