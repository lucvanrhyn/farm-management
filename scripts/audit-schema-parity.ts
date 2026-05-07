#!/usr/bin/env tsx
/**
 * Schema-parity audit CLI.
 *
 * Established by PRD #128 (2026-05-06). Runs against every tenant in the
 * meta-DB, queries `_migrations`, diffs against the migrations declared in
 * `migrations/`, and reports drift.
 *
 * Usage (governance-gate, before promote, ad-hoc):
 *   pnpm tsx scripts/audit-schema-parity.ts
 *   pnpm tsx scripts/audit-schema-parity.ts --json   # machine-readable
 *   pnpm tsx scripts/audit-schema-parity.ts --fail-on-drift  # exit 1 if drift
 *
 * Environment:
 *   META_TURSO_URL, META_TURSO_AUTH_TOKEN — required.
 *
 * Exit codes:
 *   0 — all tenants at parity (or drift detected without --fail-on-drift)
 *   1 — drift detected with --fail-on-drift
 *   2 — config / connectivity error
 */
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { getAllFarmSlugs, getFarmCreds } from '../lib/meta-db';
import { loadMigrations } from '../lib/migrator';
import {
  checkSchemaParityAcrossTenants,
  formatParityResults,
} from '../lib/ops/schema-parity';

interface CliFlags {
  json: boolean;
  failOnDrift: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: false, failOnDrift: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--json') flags.json = true;
    else if (arg === '--fail-on-drift') flags.failOnDrift = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: audit-schema-parity [--json] [--fail-on-drift]\n\n' +
          '  --json            emit JSON report on stdout\n' +
          '  --fail-on-drift   exit 1 when any tenant is missing migrations',
      );
      process.exit(0);
    }
  }
  return flags;
}

async function main(argv: readonly string[]): Promise<number> {
  const flags = parseArgs(argv);

  if (!process.env.META_TURSO_URL || !process.env.META_TURSO_AUTH_TOKEN) {
    console.error('audit-schema-parity: META_TURSO_URL / META_TURSO_AUTH_TOKEN required');
    return 2;
  }

  let slugs: string[];
  try {
    slugs = await getAllFarmSlugs();
  } catch (err) {
    console.error(
      `audit-schema-parity: failed to enumerate farms — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 2;
  }

  // Resolve a libSQL client per tenant. Skip orphans (slug with no creds).
  const tenants: { slug: string; client: ReturnType<typeof createClient>; close: () => void }[] =
    [];
  for (const slug of slugs) {
    const creds = await getFarmCreds(slug);
    if (!creds) {
      console.warn(`[parity] [${slug}] skip: no creds in meta-db`);
      continue;
    }
    const client = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
    tenants.push({ slug, client, close: () => client.close() });
  }

  // The expected list is every migration file shipped on this checkout.
  // Use fileURLToPath so paths containing spaces (e.g. dev "Obsidian Vault")
  // are decoded correctly — `.pathname` leaves %20 escapes that readdir rejects.
  const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
  const expected = (await loadMigrations(migrationsDir)).map((m) => m.name);

  let driftDetected = false;
  try {
    const results = await checkSchemaParityAcrossTenants(
      tenants.map(({ slug, client }) => ({ slug, client })),
      { expected, allowExtra: true },
    );
    driftDetected = results.some((r) => r.error || (r.report && !r.report.ok));

    if (flags.json) {
      console.log(JSON.stringify({ expected, results }, null, 2));
    } else {
      console.log(formatParityResults(results));
    }
  } finally {
    for (const t of tenants) {
      try {
        t.close();
      } catch {
        // best-effort
      }
    }
  }

  return driftDetected && flags.failOnDrift ? 1 : 0;
}

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    console.error('audit-schema-parity: fatal:', err);
    process.exit(2);
  },
);
