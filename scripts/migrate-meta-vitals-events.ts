/**
 * Idempotent migration: creates `vitals_events` table in the meta-DB for
 * Real-User Monitoring (RUM) of Core Web Vitals — LCP, CLS, INP, FCP, TTFB.
 *
 * Written to by `app/api/telemetry/vitals/route.ts`, queried by the
 * perf dashboard (follow-up) and retention sweep (below).
 *
 * Safe to run multiple times — uses CREATE TABLE IF NOT EXISTS.
 *
 * Run:  pnpm db:migrate:meta:vitals
 */
import type { Client } from '@libsql/client';
import { createClient } from '@libsql/client';

function getClient(): Client {
  const url = process.env.META_TURSO_URL;
  const authToken = process.env.META_TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error('META_TURSO_URL and META_TURSO_AUTH_TOKEN must be set');
  }
  return createClient({ url, authToken });
}

export async function runMigration(db: Client): Promise<void> {
  console.log('→ vitals_events table');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS vitals_events (
      id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL NOT NULL,
      rating TEXT NOT NULL,
      delta REAL NOT NULL DEFAULT 0,
      navigation_type TEXT,
      route TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id, metric_name)
    )
  `);

  // Composite index supports "recent metrics by route" dashboard query and
  // the 30-day prune sweep (WHERE created_at < ?).
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_vitals_events_route_created
      ON vitals_events(route, created_at)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_vitals_events_created
      ON vitals_events(created_at)
  `);

  console.log('✓ meta-db vitals_events migration complete');
}

async function main(): Promise<void> {
  const db = getClient();
  await runMigration(db);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('✗ migration failed:', err);
    process.exit(1);
  });
}
