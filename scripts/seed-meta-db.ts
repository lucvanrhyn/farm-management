/**
 * seed-meta-db.ts — provision the FarmTrack meta database
 *
 * Run once after creating the meta Turso DB:
 *   turso db create farmtrack-meta
 *   turso db show --url farmtrack-meta   → META_TURSO_URL
 *   turso db tokens create farmtrack-meta → META_TURSO_AUTH_TOKEN
 *
 * Required env vars (add to .env.local before running):
 *   META_TURSO_URL          URL of the meta Turso DB
 *   META_TURSO_AUTH_TOKEN   Auth token for the meta Turso DB
 *   TURSO_DATABASE_URL      URL of the Trio B farm Turso DB (already in .env.local)
 *   TURSO_AUTH_TOKEN        Auth token for the Trio B farm Turso DB (already in .env.local)
 *   SEED_LUC_PASSWORD       Password for the luc admin account
 *   SEED_DICKY_PASSWORD     Password for the dicky logger account
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-meta-db.ts
 *
 * Idempotent — safe to re-run. Uses INSERT OR IGNORE for all rows.
 */

import { createClient } from '@libsql/client';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'crypto';

// ── Validate env ──────────────────────────────────────────────────────────────

const required = [
  'META_TURSO_URL',
  'META_TURSO_AUTH_TOKEN',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'SEED_LUC_PASSWORD',
  'SEED_DICKY_PASSWORD',
  'SEED_OUPA_PASSWORD',
  'SEED_DEWET_PASSWORD',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

// ── Initial data — edit usernames/names here if needed ───────────────────────

const USERS = [
  {
    id: randomUUID(),
    username: 'luc',
    email: 'luc@farmtrack.app',
    name: 'Luc van Rhyn',
    password: process.env.SEED_LUC_PASSWORD!,
  },
  {
    id: randomUUID(),
    username: 'dicky',
    email: 'dicky@farmtrack.app',
    name: 'Dicky',
    password: process.env.SEED_DICKY_PASSWORD!,
  },
  {
    id: randomUUID(),
    username: 'oupa',
    email: 'oupa@farmtrack.app',
    name: 'Oupa',
    password: process.env.SEED_OUPA_PASSWORD!,
  },
  {
    id: randomUUID(),
    username: 'dewet',
    email: 'dewet@farmtrack.app',
    name: 'De Wet',
    password: process.env.SEED_DEWET_PASSWORD!,
  },
];

const FARM = {
  id: randomUUID(),
  slug: 'trio-b-boerdery',
  displayName: 'Trio B Boerdery',
  tursoUrl: process.env.TURSO_DATABASE_URL!,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN!,
  logoUrl: null as string | null,
};

// luc = ADMIN, oupa = DASHBOARD, dicky/dewet = LOGGER
const ROLES: Record<string, string> = {
  luc: 'ADMIN',
  dicky: 'LOGGER',
  oupa: 'DASHBOARD',
  dewet: 'LOGGER',
};

// ── Connect ───────────────────────────────────────────────────────────────────

const client = createClient({
  url: process.env.META_TURSO_URL!,
  authToken: process.env.META_TURSO_AUTH_TOKEN!,
});

// ── DDL ───────────────────────────────────────────────────────────────────────

async function createTables() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      email        TEXT UNIQUE NOT NULL,
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name         TEXT,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS farms (
      id               TEXT PRIMARY KEY,
      slug             TEXT UNIQUE NOT NULL,
      display_name     TEXT NOT NULL,
      turso_url        TEXT NOT NULL,
      turso_auth_token TEXT NOT NULL,
      logo_url         TEXT,
      created_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS farm_users (
      user_id  TEXT NOT NULL REFERENCES users(id),
      farm_id  TEXT NOT NULL REFERENCES farms(id),
      role     TEXT NOT NULL,
      PRIMARY KEY (user_id, farm_id)
    );
  `);
  console.log('Tables created (or already exist).');
}

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seedUsers() {
  for (const user of USERS) {
    const passwordHash = hashSync(user.password, 12);
    await client.execute({
      sql: `INSERT OR IGNORE INTO users (id, email, username, password_hash, name, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [user.id, user.email, user.username, passwordHash, user.name, new Date().toISOString()],
    });
    console.log(`User '${user.username}' — inserted (or already exists).`);
  }
}

async function seedFarm() {
  await client.execute({
    sql: `INSERT OR IGNORE INTO farms (id, slug, display_name, turso_url, turso_auth_token, logo_url, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      FARM.id,
      FARM.slug,
      FARM.displayName,
      FARM.tursoUrl,
      FARM.tursoAuthToken,
      FARM.logoUrl,
      new Date().toISOString(),
    ],
  });
  console.log(`Farm '${FARM.slug}' — inserted (or already exists).`);
}

async function seedFarmUsers() {
  // Fetch actual IDs from DB (handles re-runs where INSERT OR IGNORE skipped)
  const usersResult = await client.execute(`SELECT id, username FROM users`);
  const farmsResult = await client.execute(`SELECT id, slug FROM farms`);

  const userMap = new Map(usersResult.rows.map((r) => [r.username as string, r.id as string]));
  const farmMap = new Map(farmsResult.rows.map((r) => [r.slug as string, r.id as string]));

  const farmId = farmMap.get(FARM.slug);
  if (!farmId) {
    console.error(`Farm '${FARM.slug}' not found — aborting farm_users seed.`);
    return;
  }

  for (const user of USERS) {
    const userId = userMap.get(user.username);
    if (!userId) continue;
    const role = ROLES[user.username] ?? 'LOGGER';
    await client.execute({
      sql: `INSERT OR IGNORE INTO farm_users (user_id, farm_id, role) VALUES (?, ?, ?)`,
      args: [userId, farmId, role],
    });
    console.log(`farm_users: '${user.username}' → '${FARM.slug}' as ${role} — inserted (or already exists).`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n── FarmTrack Meta DB Seed ──────────────────────────────\n');
  await createTables();
  await seedUsers();
  await seedFarm();
  await seedFarmUsers();
  console.log('\nDone.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
