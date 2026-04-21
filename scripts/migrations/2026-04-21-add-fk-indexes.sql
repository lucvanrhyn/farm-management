-- Health Audit 2026-04-21, Workstream B
-- Adds single-column indexes on hot query paths that only had composite
-- coverage. Each CREATE INDEX IF NOT EXISTS is safe to re-run.
--
-- Apply per CLAUDE.md: do NOT use `prisma db push`. Run:
--   turso db shell delta-livestock < scripts/migrations/2026-04-21-add-fk-indexes.sql
-- Repeat for every tenant DB.

-- Observation: campId/animalId/loggedBy are filtered independently in
-- /api/observations GET (lib/server/cached.ts, app/api/observations/route.ts)
-- but only composite indexes (type, campId, observedAt) exist, so filters
-- without `type` fall back to a full scan.
CREATE INDEX IF NOT EXISTS idx_obs_camp       ON Observation (campId);
CREATE INDEX IF NOT EXISTS idx_obs_animal     ON Observation (animalId);
CREATE INDEX IF NOT EXISTS idx_obs_logged_by  ON Observation (loggedBy);

-- Transaction: animalId/campId filtered in financial analytics queries
-- (components/admin/FinancialAnalyticsPanel, animal cost-basis lookups).
CREATE INDEX IF NOT EXISTS idx_transaction_animal ON "Transaction" (animalId);
CREATE INDEX IF NOT EXISTS idx_transaction_camp   ON "Transaction" (campId);
