/**
 * migrate-meta-nullable-email.ts — Make users.email nullable in meta DB
 *
 * SQLite doesn't support ALTER COLUMN, so we recreate the table.
 * This enables username-only login for LOGGER role users (e.g. farm foremen without email).
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-meta-nullable-email.ts
 */

import { createClient } from '@libsql/client';

const url = process.env.META_TURSO_URL;
const authToken = process.env.META_TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('META_TURSO_URL and META_TURSO_AUTH_TOKEN must be set.');
  process.exit(1);
}

const client = createClient({ url, authToken });

async function migrate() {
  console.log('\n-- Migrating users table: email NOT NULL → nullable --\n');

  // Check current schema
  const tableInfo = await client.execute(`PRAGMA table_info(users)`);
  const emailCol = tableInfo.rows.find((r) => r.name === 'email');

  if (!emailCol) {
    console.error('No email column found in users table.');
    process.exit(1);
  }

  if (emailCol.notnull === 0) {
    console.log('email column is already nullable. Nothing to do.');
    process.exit(0);
  }

  console.log('Current email column: NOT NULL. Recreating table...');

  // Run each statement individually to avoid transaction issues
  await client.execute(`PRAGMA foreign_keys = OFF`);
  await client.execute(`DROP TABLE IF EXISTS users_new`);
  await client.execute(`
    CREATE TABLE users_new (
      id                    TEXT PRIMARY KEY,
      email                 TEXT UNIQUE,
      username              TEXT UNIQUE NOT NULL,
      password_hash         TEXT NOT NULL,
      name                  TEXT,
      email_verified        INTEGER NOT NULL DEFAULT 0,
      verification_token    TEXT,
      verification_expires  TEXT,
      created_at            TEXT NOT NULL
    )
  `);
  await client.execute(`
    INSERT INTO users_new
    SELECT id, email, username, password_hash, name, email_verified,
           verification_token, verification_expires,
           COALESCE(created_at, datetime('now')) AS created_at
    FROM users
  `);
  await client.execute(`DROP TABLE users`);
  await client.execute(`ALTER TABLE users_new RENAME TO users`);
  await client.execute(`PRAGMA foreign_keys = ON`);

  console.log('Migration complete. email column is now nullable.');

  // Verify
  const verify = await client.execute(`PRAGMA table_info(users)`);
  const newEmailCol = verify.rows.find((r) => r.name === 'email');
  console.log(`Verification: email notnull = ${newEmailCol?.notnull} (should be 0)`);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
