/**
 * migrate-meta-password-reset-cols.ts — Add password_reset_token +
 * password_reset_expires columns to the meta-DB users table (issue #102).
 *
 * SECURITY DECISION: these are SEPARATE columns from verification_token /
 * verification_expires. Sharing one token column across email-verify and
 * password-reset creates a cross-purpose token-confusion risk (a verify token
 * could be replayed at the reset endpoint). Separate columns enforce the
 * boundary at the DB level.
 *
 * SQLite supports ADD COLUMN without a table recreation (unlike the nullable-
 * email migration) because the new columns are nullable with no constraints
 * that break existing rows.
 *
 * !! DO NOT RUN AGAINST PRODUCTION WITHOUT OPERATOR SIGN-OFF !!
 * The promote gate for this PR is deliberately held. Run only after Luc
 * explicitly authorises the migration. See HITL note in PR #102a.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-meta-password-reset-cols.ts
 *
 * Idempotent: if the columns already exist the script exits cleanly.
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
  console.log('\n-- Migrating users table: add password_reset_token + password_reset_expires --\n');

  // Inspect current columns to check idempotency.
  const tableInfo = await client.execute(`PRAGMA table_info(users)`);
  const colNames = tableInfo.rows.map((r) => String(r.name));

  const hasResetToken = colNames.includes('password_reset_token');
  const hasResetExpires = colNames.includes('password_reset_expires');

  if (hasResetToken && hasResetExpires) {
    console.log('Both columns already exist. Nothing to do.');
    process.exit(0);
  }

  if (!hasResetToken) {
    console.log('Adding password_reset_token column...');
    await client.execute(`
      ALTER TABLE users ADD COLUMN password_reset_token TEXT
    `);
    console.log('  password_reset_token: added (nullable TEXT)');
  } else {
    console.log('  password_reset_token: already present, skipping');
  }

  if (!hasResetExpires) {
    console.log('Adding password_reset_expires column...');
    await client.execute(`
      ALTER TABLE users ADD COLUMN password_reset_expires TEXT
    `);
    console.log('  password_reset_expires: added (nullable TEXT / ISO-8601)');
  } else {
    console.log('  password_reset_expires: already present, skipping');
  }

  console.log('\nMigration complete.');

  // Verify
  const verify = await client.execute(`PRAGMA table_info(users)`);
  const verifyNames = verify.rows.map((r) => String(r.name));
  console.log(`\nVerification — users table columns: ${verifyNames.join(', ')}`);

  const tokenOk = verifyNames.includes('password_reset_token');
  const expiresOk = verifyNames.includes('password_reset_expires');
  if (!tokenOk || !expiresOk) {
    console.error('Verification FAILED — expected columns not found.');
    process.exit(1);
  }
  console.log('Verification PASSED.');
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
