-- 0013_payfast_events.sql
--
-- Wave 4c A11 — PayFast ITN webhook idempotency dedup table.
--
-- Codex adversarial review 2026-05-02 (HIGH severity, finding #9):
-- the ITN webhook at app/api/webhooks/payfast/route.ts was not idempotent.
-- PayFast retries `pf_payment_id` and we processed every retry, mutating
-- subscription state N times. Late-arriving events overwrote newer state.
--
-- This table is the dedup ledger. One row per processed PayFast event.
-- The route INSERTs first; on UNIQUE collision (P2002) it knows the event
-- has already been processed and short-circuits. `eventTime` lets the route
-- reject events older than the latest seen event for the farm (clock skew
-- defence — late arrivals from PayFast's retry queue must not clobber
-- newer subscription state).
--
-- Identifier is double-quoted because `Transaction` and friends in this
-- codebase taught us that libSQL parses unquoted reserved-ish words as
-- keywords (see feedback-quote-sql-keywords-in-migrations.md). `PayfastEvent`
-- isn't reserved, but quoting it costs nothing and matches the convention
-- used by other Prisma-generated tables in this DB.

CREATE TABLE IF NOT EXISTS "PayfastEvent" (
  "id"           TEXT PRIMARY KEY,
  "pfPaymentId"  TEXT NOT NULL,
  "eventTime"    DATETIME NOT NULL,
  "paymentStatus" TEXT NOT NULL,
  "payloadHash"  TEXT NOT NULL,
  "processedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The dedup contract. PayFast's pf_payment_id is unique per logical
-- payment, so this UNIQUE index is what enforces "process at most once".
-- The route catches Prisma error code P2002 on this index to detect
-- duplicates without a second SELECT.
CREATE UNIQUE INDEX IF NOT EXISTS "payfast_events_pf_payment_id_idx"
  ON "PayfastEvent" ("pfPaymentId");

-- Queried by the timestamp-ordering check: "is this event older than the
-- newest event we've already processed for this tenant?". The tenant DB
-- already isolates by farm so we don't need a farmSlug column here.
CREATE INDEX IF NOT EXISTS "payfast_events_event_time_idx"
  ON "PayfastEvent" ("eventTime");
