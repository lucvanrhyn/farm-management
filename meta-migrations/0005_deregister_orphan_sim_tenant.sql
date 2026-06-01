-- Meta-DB migration 0005: de-register the orphaned H0b-repro sim tenant.
--
-- `onboarding-sim-demo-0601` was provisioned in a prior session FROM THE STALE
-- bootstrap to reproduce the H0b onboarding-drift incident (#280). It was born
-- missing 14 tables + ~40 columns and has no `_migrations` table — i.e. it is
-- the H0b bug made manifest as a real registered tenant. Because the governance
-- gate's schema-parity check (`scripts/audit-schema-parity.ts`) enumerates EVERY
-- registered tenant via `getAllFarmSlugs()` and fails on any drift, this single
-- broken throwaway was failing `gate` for EVERY pull request — jamming the whole
-- merge pipeline (basson-boerdery and trio-b-boerdery are both healthy at 43-table
-- parity, so the H0b fix itself regresses nothing).
--
-- This migration removes ONLY the META registration rows for that slug so the
-- gate stops enumerating it. It is deliberately NON-DESTRUCTIVE to the tenant's
-- own Turso database: that DB is left intact on Turso (just unhooked from the
-- registry) so the broken-state artifact remains available for inspection. We do
-- not DROP the Turso DB (no Turso control-plane access from the migration layer,
-- and per the standing "nothing destructive" constraint).
--
-- Order: delete the farm_users link rows first (they FK-reference farms(id)),
-- then the farms row. The users row is intentionally left untouched (the sim's
-- login account is harmless and may be shared). Idempotent: a no-op once the
-- rows are gone, so re-running `scripts/migrate.ts --meta-only` is safe. Tracked
-- by name in `_meta_migrations`.

DELETE FROM farm_users
  WHERE farm_id IN (SELECT id FROM farms WHERE slug = 'onboarding-sim-demo-0601');

DELETE FROM farms WHERE slug = 'onboarding-sim-demo-0601';
