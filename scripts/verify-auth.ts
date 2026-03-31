/**
 * verify-auth.ts — check whether env passwords match the hashes stored in meta DB
 *
 * Exits 0 if all passwords are in sync.
 * Exits 1 and prints a clear alert if any password is out of sync or a user
 * is missing from the DB — so this can be used as a CI/pre-deploy check.
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
 *   pnpm db:verify-auth
 *   (or: npx dotenv-cli -e .env.local -- npx tsx scripts/verify-auth.ts)
 */

import { createClient } from '@libsql/client';
import { compareSync } from 'bcryptjs';

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

// ── Users to verify ───────────────────────────────────────────────────────────

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
  console.log('\n── FarmTrack Auth Verification ─────────────────────────\n');

  // Fetch all user hashes in one query
  const result = await client.execute(
    `SELECT username, password_hash FROM users WHERE username IN ('luc','dicky','oupa','dewet')`
  );

  const dbMap = new Map<string, string>(
    result.rows.map((r) => [r.username as string, r.password_hash as string])
  );

  let allOk = true;

  for (const user of USERS) {
    const storedHash = dbMap.get(user.username);

    if (!storedHash) {
      console.error(`✗ DRIFT DETECTED — '${user.username}' not found in meta DB`);
      console.error(`  → Fix: run  pnpm db:seed:meta  to create the user\n`);
      allOk = false;
      continue;
    }

    const matches = compareSync(user.password, storedHash);
    if (matches) {
      console.log(`✓ '${user.username}' — env password matches DB hash`);
    } else {
      console.error(`✗ DRIFT DETECTED — '${user.username}' env password does NOT match DB hash`);
      console.error(`  → Fix: run  pnpm db:resync-passwords  to update the DB hash\n`);
      allOk = false;
    }
  }

  if (allOk) {
    console.log('\nAll passwords are in sync. No action needed.\n');
    process.exit(0);
  } else {
    console.error(
      '\n⚠ Password drift detected. Affected accounts cannot log in.\n' +
        'Run  pnpm db:resync-passwords  to fix, then re-run  pnpm db:verify-auth  to confirm.\n'
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
