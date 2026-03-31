/**
 * resync-passwords.ts — update all user password hashes in the meta DB from env vars
 *
 * Use this whenever .env.local SEED_*_PASSWORD values have changed and the DB
 * hashes are no longer in sync (e.g. Bug #7 — meta DB seeded at a different
 * time than .env.local was last updated).
 *
 * Required env vars (in .env.local):
 *   META_TURSO_URL
 *   META_TURSO_AUTH_TOKEN
 *   SEED_LUC_PASSWORD
 *   SEED_DICKY_PASSWORD
 *   SEED_OUPA_PASSWORD
 *   SEED_DEWET_PASSWORD
 *
 * Run:
 *   pnpm db:resync-passwords
 *   (or: npx dotenv-cli -e .env.local -- npx tsx scripts/resync-passwords.ts)
 *
 * Safe to re-run at any time. Only updates password_hash — never touches IDs,
 * emails, roles, or farm associations.
 */

import { createClient } from '@libsql/client';
import { hashSync } from 'bcryptjs';

// ── Validate env ──────────────────────────────────────────────────────────────

const required = [
  'META_TURSO_URL',
  'META_TURSO_AUTH_TOKEN',
  'SEED_LUC_PASSWORD',
  'SEED_DICKY_PASSWORD',
  'SEED_OUPA_PASSWORD',
  'SEED_DEWET_PASSWORD',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`✗ Missing required env var: ${key}`);
    process.exit(1);
  }
}

// ── Users to resync ───────────────────────────────────────────────────────────

const USERS: { username: string; password: string }[] = [
  { username: 'luc',   password: process.env.SEED_LUC_PASSWORD! },
  { username: 'dicky', password: process.env.SEED_DICKY_PASSWORD! },
  { username: 'oupa',  password: process.env.SEED_OUPA_PASSWORD! },
  { username: 'dewet', password: process.env.SEED_DEWET_PASSWORD! },
];

// ── Connect ───────────────────────────────────────────────────────────────────

const client = createClient({
  url: process.env.META_TURSO_URL!,
  authToken: process.env.META_TURSO_AUTH_TOKEN!,
});

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n── FarmTrack Password Resync ───────────────────────────\n');

  let updated = 0;
  let notFound = 0;

  for (const user of USERS) {
    const passwordHash = hashSync(user.password, 12);

    const result = await client.execute({
      sql: `UPDATE users SET password_hash = ? WHERE username = ?`,
      args: [passwordHash, user.username],
    });

    const rowsAffected = result.rowsAffected ?? 0;
    if (rowsAffected > 0) {
      console.log(`✓ '${user.username}' — password hash updated`);
      updated++;
    } else {
      console.warn(`⚠ '${user.username}' — user not found in DB (was the DB seeded?)`);
      notFound++;
    }
  }

  console.log(`\nResync complete: ${updated} updated, ${notFound} not found.\n`);

  if (notFound > 0) {
    console.log(
      'Tip: For users not found, run the full seed first:\n' +
        '  pnpm db:seed:meta\n'
    );
  }

  process.exit(notFound > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Resync failed:', err);
  process.exit(1);
});
