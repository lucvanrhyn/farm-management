-- Phase-J perf: composite index serving the /api/notifications cache-miss
-- query. The cached fetcher in lib/server/cached.ts filters rows with
-- `expiresAt > now` and sorts by `[isRead asc, createdAt desc]`. The existing
-- @@index([isRead, createdAt]) only serves the sort; the `expiresAt`
-- predicate degrades to a filter-scan over the sort output and scales
-- linearly with notification volume. Leading the composite with `expiresAt`
-- lets the planner narrow the row set via the predicate first.
--
-- Paired with prisma/schema.prisma Notification.@@index([expiresAt, isRead, createdAt]).
-- IF NOT EXISTS keeps the migration safe on tenants where an operator may
-- have pre-created the index manually.
CREATE INDEX IF NOT EXISTS idx_notification_expires_read_created
  ON "Notification" ("expiresAt", "isRead", "createdAt");
