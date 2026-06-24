import type { Client } from "@libsql/client";

/**
 * META_BASE_DDL — the complete base schema for the FarmTrack meta database, as
 * it exists BEFORE any numbered meta-migration is applied.
 *
 * This is the single source of truth for provisioning a fresh meta DB
 * (scripts/seed-meta-db.ts calls createMetaTables() with it). The numbered
 * migrations in meta-migrations/ apply ON TOP of this base — they exist to
 * upgrade meta DBs that were provisioned before a given table/column existed.
 *
 * INVARIANT — this DDL must NOT declare any column added by a bare
 * `ALTER TABLE ... ADD COLUMN` migration, because the runner applies every
 * not-yet-tracked migration to a freshly-seeded DB and a duplicate column would
 * abort the run. Specifically it omits:
 *   - branch_db_clones.head_sha, .soak_started_at        (0001)
 *   - branch_db_clones.last_smoke_status, .last_smoke_at (0002)
 *   - users.password_reset_token, .password_reset_expires (0004)
 *
 * Everything else the application reads MUST be here so a freshly-seeded meta DB
 * is immediately usable. Historically branch_db_clones, vitals_events,
 * consulting_leads/engagements and the farms subscription/billing/legacy columns
 * only existed via hand-rolled scripts/migrate-meta-*.ts scripts and were absent
 * from the seed — so a fresh meta DB was un-provisionable: migration 0001
 * ALTERed a branch_db_clones table the seed never created. Closing that
 * parity gap is the purpose of this module;
 * __tests__/lib/meta-schema-fresh-provision.test.ts guards it end-to-end.
 *
 * Idempotent: every statement uses CREATE TABLE/INDEX IF NOT EXISTS, so running
 * it against an existing meta DB is a safe no-op (the additive columns on an
 * already-provisioned prod META are no-ops too — CREATE IF NOT EXISTS skips the
 * table, it does not reconcile columns).
 */
export const META_BASE_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id                    TEXT PRIMARY KEY,
    email                 TEXT UNIQUE,
    username              TEXT UNIQUE NOT NULL,
    password_hash         TEXT NOT NULL,
    name                  TEXT,
    email_verified        INTEGER NOT NULL DEFAULT 0,
    verification_token    TEXT,
    verification_expires  TEXT,
    created_at            TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS farms (
    id                      TEXT PRIMARY KEY,
    slug                    TEXT UNIQUE NOT NULL,
    display_name            TEXT NOT NULL,
    turso_url               TEXT NOT NULL,
    turso_auth_token        TEXT NOT NULL,
    logo_url                TEXT,
    tier                    TEXT NOT NULL DEFAULT 'advanced',
    created_at              TEXT NOT NULL,
    subscription_status     TEXT,
    subscription_started_at TEXT,
    payfast_token           TEXT,
    billing_frequency       TEXT,
    locked_lsu              INTEGER,
    billing_amount_zar      INTEGER,
    next_renewal_at         TEXT,
    legacy_turso_url        TEXT,
    legacy_turso_auth_token TEXT
  );

  CREATE TABLE IF NOT EXISTS farm_users (
    user_id  TEXT NOT NULL REFERENCES users(id),
    farm_id  TEXT NOT NULL REFERENCES farms(id),
    role     TEXT NOT NULL,
    PRIMARY KEY (user_id, farm_id)
  );

  CREATE TABLE IF NOT EXISTS "RateLimit" (
    "key"           TEXT PRIMARY KEY,
    "windowStartMs" INTEGER NOT NULL,
    "count"         INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS branch_db_clones (
    branch_name        TEXT PRIMARY KEY,
    turso_db_name      TEXT NOT NULL,
    turso_db_url       TEXT NOT NULL,
    turso_auth_token   TEXT NOT NULL,
    source_db_name     TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    last_promoted_at   TEXT,
    prod_migration_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_branch_db_clones_created_at
    ON branch_db_clones(created_at);

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
  );

  CREATE INDEX IF NOT EXISTS idx_vitals_events_route_created
    ON vitals_events(route, created_at);

  CREATE INDEX IF NOT EXISTS idx_vitals_events_created
    ON vitals_events(created_at);

  CREATE TABLE IF NOT EXISTS consulting_leads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    farm_name TEXT NOT NULL,
    province TEXT,
    species_json TEXT,
    herd_size INTEGER,
    data_notes TEXT,
    custom_tracking TEXT,
    source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    assigned_to TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_consulting_leads_status
    ON consulting_leads(status);

  CREATE TABLE IF NOT EXISTS consulting_engagements (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    farm_id TEXT,
    setup_fee_zar INTEGER NOT NULL,
    retainer_fee_zar INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ends_at TEXT,
    status TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES consulting_leads(id)
  );
`;

/**
 * Create the full meta-DB base schema on `client`. Idempotent — safe to re-run
 * against an already-provisioned meta DB. Run the numbered meta-migrations
 * (lib/meta-migrator.ts) AFTER this to bring the DB fully up to date.
 */
export async function createMetaTables(client: Client): Promise<void> {
  await client.executeMultiple(META_BASE_DDL);
}
