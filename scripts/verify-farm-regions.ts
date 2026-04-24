#!/usr/bin/env tsx
/**
 * verify-farm-regions — Phase E smoke assertion.
 *
 * Reads every farm from the meta DB, classifies its `turso_url` by region,
 * and exits non-zero if any farm isn't in the expected region.
 *
 * Usage:
 *   pnpm tsx scripts/verify-farm-regions.ts              # default: target = dub
 *   pnpm tsx scripts/verify-farm-regions.ts --target nrt # during migration window
 *
 * Intended CI hooks:
 *   - Post-cutover: run in a GitHub Actions cron to alert if any farm drifts.
 *   - Pre-deploy: add as a release gate once Phase E is fully shipped.
 *
 * Exit codes:
 *   0 ─ all farms in target region
 *   1 ─ one or more farms in a different region (details printed)
 *   2 ─ operator/env error
 */

import { createClient } from "@libsql/client";
import { assertAllFarmsInRegion, type TursoRegion } from "@/lib/turso-region";

interface Args {
  target: TursoRegion;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { target: "dub" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") args.target = (argv[++i] ?? "dub") as TursoRegion;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.META_TURSO_URL;
  const authToken = process.env.META_TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error("Missing META_TURSO_URL / META_TURSO_AUTH_TOKEN");
    process.exit(2);
  }

  const meta = createClient({ url, authToken });
  const res = await meta.execute({
    sql: `SELECT slug, turso_url FROM farms ORDER BY slug`,
    args: [],
  });
  const farms = res.rows.map((r) => ({
    slug: r.slug as string,
    tursoUrl: r.turso_url as string,
  }));

  const result = assertAllFarmsInRegion(farms, args.target);

  if (result.ok) {
    console.log(`✓ all ${farms.length} farms in region "${args.target}"`);
    process.exit(0);
  }

  console.error(
    `✗ ${result.offending.length} / ${farms.length} farms NOT in region "${args.target}":`,
  );
  for (const f of result.offending) {
    console.error(`  - ${f.slug}  region=${f.actualRegion ?? "unknown"}  url=${f.tursoUrl}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(2);
});
