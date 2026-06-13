/**
 * Shared fixed-window rate limiter, backed by the META Turso DB.
 *
 * Why not the old in-memory `Map`? On Vercel every serverless instance kept
 * its OWN window and cold starts wiped it, so the cap was per-instance, not
 * global — an attacker hitting auth / import / Einstein endpoints across
 * instances trivially bypassed it (findings api-M2 / OB-003 / auth-M3 /
 * auth-F1). A single shared row in the META DB makes the counter authoritative
 * across all instances at zero new infra/cost (the META DB already exists).
 *
 * Fixed-window vs sliding-window: a fixed-window counter is a single atomic
 * upsert (no per-request timestamp array to read-modify-write), which is
 * race-free under concurrency. The trade-off — up to 2x burst at a window
 * boundary — is acceptable for best-effort cost/abuse protection.
 *
 * FAIL OPEN: if the META DB is unreachable we log a structured warning and
 * allow the request. Rate limiting is best-effort; a meta-DB blip must never
 * lock users out. This deliberately preserves the availability semantics of
 * the old cold-start behaviour (which also effectively "failed open" by
 * dropping its in-memory state).
 *
 * Table provisioned by meta-migrations/0006_rate_limit_table.sql (existing
 * META DBs) and scripts/seed-meta-db.ts createTables() (fresh META DBs).
 */

import { getMetaClient } from '@/lib/meta-db';
import { logger } from '@/lib/logger';

/**
 * Atomically increment the fixed-window counter for `key` and return whether
 * the request is allowed.
 *
 * The single statement does the whole window decision in SQLite:
 *   - If the row's window is still open (windowStartMs + windowMs > now),
 *     increment the count and keep the window start.
 *   - Otherwise (expired or first hit) reset count to 1 and start a new
 *     window at `now`.
 * RETURNING gives us the post-update count + window start in one round-trip.
 *
 * `allowed = count <= maxRequests`. `retryAfterMs` is how long until the
 * current window closes, 0 when allowed.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const now = Date.now();

  try {
    const client = getMetaClient();
    const result = await client.execute({
      sql: `INSERT INTO "RateLimit" ("key", "windowStartMs", "count")
            VALUES (?, ?, 1)
            ON CONFLICT("key") DO UPDATE SET
              "count" = CASE
                WHEN "RateLimit"."windowStartMs" + ? > ?
                  THEN "RateLimit"."count" + 1
                ELSE 1
              END,
              "windowStartMs" = CASE
                WHEN "RateLimit"."windowStartMs" + ? > ?
                  THEN "RateLimit"."windowStartMs"
                ELSE ?
              END
            RETURNING "count", "windowStartMs"`,
      args: [key, now, windowMs, now, windowMs, now, now],
    });

    const row = result.rows[0];
    const count = Number(row.count);
    const windowStartMs = Number(row.windowStartMs);

    const allowed = count <= maxRequests;
    const retryAfterMs = allowed ? 0 : windowStartMs + windowMs - now;
    return { allowed, retryAfterMs };
  } catch (err) {
    // FAIL OPEN — best-effort guard. A META-DB blip must not lock users out.
    // Structured warning (not a silent catch) so the blip is observable.
    logger.warn('[rate-limit] META DB unavailable — failing open', {
      key,
      error: err,
    });
    return { allowed: true, retryAfterMs: 0 };
  }
}

/**
 * Prune rate-limit rows whose fixed window closed more than `olderThanMs` ago.
 *
 * Each distinct key (IP / identifier) leaves a permanent row: the window resets
 * in place on the next hit but the row never departs, so the table grows with
 * the set of unique keys ever seen. A closed-window row carries no live state —
 * a later request for the same key simply re-inserts a fresh count=1 row — so
 * deleting it is correctness-neutral. The default TTL (24h) sits comfortably
 * beyond the longest window any caller uses (1h, the register limiter), so we
 * never delete a row that could still be enforcing a cap.
 *
 * Invoked by the `daily-rate-limit-cleanup` Inngest cron. FAIL SOFT: a META-DB
 * blip must not break the scheduled job — we log and return 0, mirroring
 * checkRateLimit's fail-open stance. Returns the number of rows deleted.
 */
export async function cleanupExpiredRateLimits(
  olderThanMs: number = 24 * 60 * 60 * 1000,
): Promise<number> {
  const cutoff = Date.now() - olderThanMs;

  try {
    const client = getMetaClient();
    const result = await client.execute({
      sql: `DELETE FROM "RateLimit" WHERE "windowStartMs" < ?`,
      args: [cutoff],
    });
    return result.rowsAffected ?? 0;
  } catch (err) {
    logger.warn('[rate-limit] cleanup skipped — META DB unavailable', {
      error: err,
    });
    return 0;
  }
}
