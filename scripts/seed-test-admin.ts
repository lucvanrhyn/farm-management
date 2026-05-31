/**
 * seed-test-admin.ts — thin CLI wrapper around lib/ops/seed-test-admin.ts.
 *
 * Provisions a verified ADMIN login in the meta DB and links it to an EXISTING
 * tenant, so an AFK / CI agent can authenticate against a real branch clone.
 * Code half of the #108 gate (issue #527, PRD #521). Running this once with the
 * meta creds present closes #108 — it is an operator step.
 *
 * Required env vars (add to .env.local before running):
 *   META_TURSO_URL          URL of the meta Turso DB
 *   META_TURSO_AUTH_TOKEN   Auth token for the meta Turso DB
 *   TEST_ADMIN_EMAIL        Email for the seeded admin account
 *   TEST_ADMIN_PASSWORD     Plaintext password (hashed at bcrypt cost 12)
 *   TEST_ADMIN_FARM_SLUG    Slug of the EXISTING tenant to grant ADMIN on
 *
 * Optional:
 *   SEED_TEST_ADMIN_FORCE=1 Bypass the prod-tenant guard (basson-boerdery).
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-test-admin.ts
 *
 * Idempotent — safe to re-run. Never creates farms; the tenant must exist.
 * NEVER hardcode credentials — everything comes from the environment.
 */

import { createClient } from '@libsql/client';
import { seedTestAdmin, TestAdminSeedError } from '../lib/ops/seed-test-admin';

const REQUIRED_ENV = [
  'META_TURSO_URL',
  'META_TURSO_AUTH_TOKEN',
  'TEST_ADMIN_EMAIL',
  'TEST_ADMIN_PASSWORD',
  'TEST_ADMIN_FARM_SLUG',
] as const;

function readEnvOrExit(): {
  metaUrl: string;
  metaToken: string;
  email: string;
  password: string;
  farmSlug: string;
  force: boolean;
} {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required env var(s): ${missing.join(', ')}`);
    console.error('See the header of scripts/seed-test-admin.ts for the full list.');
    process.exit(1);
  }
  return {
    metaUrl: process.env.META_TURSO_URL!,
    metaToken: process.env.META_TURSO_AUTH_TOKEN!,
    email: process.env.TEST_ADMIN_EMAIL!,
    password: process.env.TEST_ADMIN_PASSWORD!,
    farmSlug: process.env.TEST_ADMIN_FARM_SLUG!,
    force: process.env.SEED_TEST_ADMIN_FORCE === '1',
  };
}

async function main(): Promise<void> {
  const env = readEnvOrExit();

  const client = createClient({ url: env.metaUrl, authToken: env.metaToken });

  const result = await seedTestAdmin(client, {
    email: env.email,
    password: env.password,
    farmSlug: env.farmSlug,
    force: env.force,
  });

  console.log('\n── Test-admin seed ─────────────────────────────────────');
  console.log(`  tenant      : ${env.farmSlug} (${result.farmId})`);
  console.log(`  user        : ${env.email} (${result.userId})`);
  console.log(`  user row    : ${result.createdUser ? 'created' : 'already existed'}`);
  console.log(`  membership  : ${result.createdMembership ? 'created (ADMIN)' : 'already existed'}`);
  console.log('  Done.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    if (err instanceof TestAdminSeedError) {
      console.error(`Seed refused: ${err.message}`);
    } else {
      console.error('Seed failed:', err);
    }
    process.exit(1);
  });
