-- 0014_payfast_events_applied_at.sql
--
-- Issue #95 — PayFast idempotency can swallow successful payment.
--
-- Root cause (two facets):
--   A. The dedup ledger row was inserted BEFORE updateFarmSubscription ran.
--      If the mutation threw, the row was already committed — PayFast retries
--      got 200'd as "already processed" and the tenant never went active.
--      Silent revenue loss.
--
--   B. PayFast sends PENDING then COMPLETE with the same pf_payment_id.
--      The PENDING insert claimed the unique index; the later COMPLETE was
--      deduped as already-processed without ever running subscription
--      activation. Subscription stayed inactive.
--
-- Fix: add an `appliedAt` column that is initially NULL.
--   • The route inserts the row with appliedAt = NULL (the race guard is
--     preserved — two concurrent retries cannot both pass an existence check).
--   • After the subscription mutation succeeds, the route sets
--     appliedAt = current_timestamp.
--   • On P2002 (duplicate pfPaymentId), the route fetches the existing row:
--       - appliedAt IS NULL  → prior attempt failed; re-run the mutation.
--       - appliedAt IS NOT NULL AND status unchanged/downgraded → safe no-op.
--       - appliedAt IS NULL  AND incoming status is COMPLETE but stored is
--         PENDING → upgrade the row and apply the mutation.
--
-- Existing rows (from migration 0013) get appliedAt = NULL, which is correct:
-- we cannot retroactively know whether the subscription mutation succeeded for
-- those events. If PayFast ever retries one of them the route will re-apply
-- idempotently (updateFarmSubscription is already idempotent for active subs).

ALTER TABLE "PayfastEvent" ADD COLUMN "appliedAt" DATETIME;

-- Index to make "find rows with appliedAt IS NULL" efficient during ops audits.
CREATE INDEX IF NOT EXISTS "payfast_events_applied_at_idx"
  ON "PayfastEvent" ("appliedAt");
