#!/usr/bin/env tsx
/**
 * migrate-farm-to-frankfurt — Phase E per-farm Turso migration driver.
 *
 * Copies a single farm's Turso database from its current region (typically
 * Tokyo / `aws-ap-northeast-1`) to Frankfurt (`aws-eu-central-1`) and
 * updates the meta DB `farms` row atomically.
 *
 * Usage (single farm, dry-run first — always):
 *   pnpm tsx scripts/migrate-farm-to-frankfurt.ts --slug delta-livestock --dry-run
 *   pnpm tsx scripts/migrate-farm-to-frankfurt.ts --slug delta-livestock
 *
 * Rollback (flips the meta-DB URL back to the previous value — the old Turso
 * DB must still exist):
 *   pnpm tsx scripts/migrate-farm-to-frankfurt.ts --slug delta-livestock --rollback
 *
 * Safety properties:
 *   - Dry-run mode prints every step without executing (except `SELECT`s).
 *   - Row-count parity check after restore; aborts if any table mismatches.
 *   - Stores rollback pointer to the old URL in `farms.legacy_turso_url`
 *     (migrations/NNNN_add_legacy_turso_url.sql must be applied first).
 *   - Never deletes the source DB. Operator retires the source manually
 *     once all farms are cut over and the soak window passes.
 *
 * Prereqs:
 *   - TURSO_API_TOKEN + TURSO_ORG env (for the management API)
 *   - turso CLI installed locally (used for `db shell .dump` — the management
 *     API does not expose dump/restore at this time)
 *   - META_TURSO_URL + META_TURSO_AUTH_TOKEN env (for the meta DB swap)
 *
 * Exit codes:
 *   0  ─ migration complete and verified
 *   1  ─ verification failed (row counts diverged, creds missing, etc.)
 *   2  ─ operator error (bad args, missing CLI, etc.)
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { createTursoDatabase, deleteTursoDatabase } from "@/lib/turso-api";
import {
  isTargetRegion,
  parseTursoRegion,
  type TursoRegion,
} from "@/lib/turso-region";

interface Args {
  slug: string;
  dryRun: boolean;
  rollback: boolean;
  targetRegion: TursoRegion;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    slug: "",
    dryRun: false,
    rollback: false,
    targetRegion: "dub",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--slug") args.slug = argv[++i] ?? "";
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--rollback") args.rollback = true;
    else if (a === "--target-region") args.targetRegion = (argv[++i] ?? "dub") as TursoRegion;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: migrate-farm-to-frankfurt.ts --slug <slug> [--dry-run] [--rollback] [--target-region dub|fra|nrt|iad]",
      );
      process.exit(0);
    }
  }
  if (!args.slug) {
    console.error("Error: --slug is required");
    process.exit(2);
  }
  return args;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Error: missing env var ${name}`);
    process.exit(2);
  }
  return v;
}

function ensureTursoCli(): void {
  try {
    execSync("turso --version", { stdio: "ignore" });
  } catch {
    console.error(
      "Error: `turso` CLI not found in PATH. Install from https://docs.turso.tech/cli/installation",
    );
    process.exit(2);
  }
}

function getMetaClient() {
  return createClient({
    url: requireEnv("META_TURSO_URL"),
    authToken: requireEnv("META_TURSO_AUTH_TOKEN"),
  });
}

async function fetchFarm(slug: string) {
  const meta = getMetaClient();
  const res = await meta.execute({
    sql: `SELECT slug, turso_url, turso_auth_token, legacy_turso_url, legacy_turso_auth_token
          FROM farms WHERE slug = ? LIMIT 1`,
    args: [slug],
  });
  if (res.rows.length === 0) {
    console.error(`Error: farm "${slug}" not found in meta DB`);
    process.exit(1);
  }
  const row = res.rows[0];
  return {
    slug: row.slug as string,
    tursoUrl: row.turso_url as string,
    tursoAuthToken: row.turso_auth_token as string,
    legacyTursoUrl: (row.legacy_turso_url as string) ?? null,
    legacyTursoAuthToken: (row.legacy_turso_auth_token as string) ?? null,
  };
}

async function countRowsByTable(url: string, authToken: string): Promise<Map<string, number>> {
  const client = createClient({ url, authToken });
  const tables = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_migrations%'`,
    args: [],
  });
  const counts = new Map<string, number>();
  for (const t of tables.rows) {
    const tableName = t.name as string;
    const c = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM "${tableName}"`,
      args: [],
    });
    counts.set(tableName, Number(c.rows[0].n));
  }
  return counts;
}

function compareCounts(
  src: Map<string, number>,
  dst: Map<string, number>,
): { ok: boolean; diffs: string[] } {
  const diffs: string[] = [];
  for (const [table, n] of src) {
    const m = dst.get(table);
    if (m === undefined) diffs.push(`${table}: missing in destination`);
    else if (m !== n) diffs.push(`${table}: src=${n} dst=${m}`);
  }
  for (const [table] of dst) {
    if (!src.has(table)) diffs.push(`${table}: unexpected in destination`);
  }
  return { ok: diffs.length === 0, diffs };
}

async function migrate(args: Args) {
  console.log(`[phase-e] Migrating farm "${args.slug}" to region "${args.targetRegion}"`);
  ensureTursoCli();

  const farm = await fetchFarm(args.slug);
  const currentRegion = parseTursoRegion(farm.tursoUrl);
  console.log(`[phase-e] Current URL: ${farm.tursoUrl} (region=${currentRegion ?? "unknown"})`);

  if (isTargetRegion(farm.tursoUrl, args.targetRegion)) {
    console.log(`[phase-e] Farm already in target region — nothing to do.`);
    return;
  }

  // 1. Dump source DB to local file via the turso CLI (the mgmt API has no
  //    dump/restore endpoint at the time of writing).
  //
  // DB-name derivation: Turso's URL subdomain is `<dbname>-<org>`, NOT the
  // raw DB name. Example: DB `delta-livestock` on org `lucvanrhyn` has URL
  // host `delta-livestock-lucvanrhyn.aws-*.turso.io`. Naive `.split(".")[0]`
  // yields the subdomain (which `turso db shell` then rejects as "not
  // found"). Strip the `-<org>` suffix to recover the real DB name.
  const workDir = mkdtempSync(join(tmpdir(), `phase-e-${args.slug}-`));
  const dumpPath = join(workDir, `${args.slug}.sql`);
  const org = requireEnv("TURSO_ORG");
  const subdomain = farm.tursoUrl.replace(/^libsql:\/\//, "").split(".")[0];
  const orgSuffix = `-${org}`;
  const sourceDbName = subdomain.endsWith(orgSuffix)
    ? subdomain.slice(0, -orgSuffix.length)
    : subdomain;
  console.log(`[phase-e] Dumping source DB "${sourceDbName}" → ${dumpPath}`);
  if (args.dryRun) {
    console.log(`[dry-run] would run: turso db shell ${sourceDbName} .dump < /dev/null > ${dumpPath}`);
  } else {
    // `< /dev/null` is load-bearing: without it, `turso db shell <db> .dump`
    // tries to read the next command from stdin after the .dump completes,
    // hits the parent's closed TTY, emits "Error: unexpected EOF" to stderr,
    // exits non-zero, AND silently truncates the dump mid-write. With stdin
    // pointed at /dev/null the CLI exits cleanly once .dump finishes.
    execSync(`turso db shell ${sourceDbName} .dump < /dev/null > ${dumpPath}`, {
      stdio: ["ignore", "pipe", "inherit"],
    });
  }

  // 2. Provision target DB in the new region, with a temporary name so we can
  //    rename during the swap. Target name = `<slug>-fra` (operator can
  //    rename via turso CLI afterwards if desired).
  const targetDbName = `${args.slug}-${args.targetRegion}`;
  console.log(`[phase-e] Creating target DB "${targetDbName}" in ${args.targetRegion}`);
  if (args.dryRun) {
    console.log(`[dry-run] would run: createTursoDatabase("${targetDbName}", { location: "${args.targetRegion}" })`);
    console.log("[dry-run] Stopping here — no destructive actions taken.");
    return;
  }

  let newDb;
  try {
    newDb = await createTursoDatabase(targetDbName, { location: args.targetRegion });
  } catch (err) {
    console.error(`[phase-e] Failed to create target DB:`, err);
    process.exit(1);
  }

  // 3. Restore dump into the new DB via turso CLI.
  console.log(`[phase-e] Restoring dump into "${targetDbName}"`);
  try {
    execSync(`turso db shell ${targetDbName} < ${dumpPath}`, {
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (err) {
    console.error(`[phase-e] Restore failed, deleting target DB:`, err);
    await deleteTursoDatabase(targetDbName);
    process.exit(1);
  }

  // 4. Row-count parity check.
  console.log(`[phase-e] Comparing row counts...`);
  const srcCounts = await countRowsByTable(farm.tursoUrl, farm.tursoAuthToken);
  const dstCounts = await countRowsByTable(newDb.url, newDb.token);
  const cmp = compareCounts(srcCounts, dstCounts);
  if (!cmp.ok) {
    console.error(`[phase-e] Row-count parity FAILED:`);
    for (const d of cmp.diffs) console.error(`  - ${d}`);
    console.error(`[phase-e] Leaving target DB "${targetDbName}" in place for inspection.`);
    process.exit(1);
  }
  console.log(`[phase-e] Parity OK across ${srcCounts.size} tables.`);

  // 5. Swap meta DB row atomically — stash old URL in `legacy_*` columns so
  //    --rollback can flip back.
  console.log(`[phase-e] Swapping meta DB pointer for "${args.slug}"`);
  const meta = getMetaClient();
  await meta.execute({
    sql: `UPDATE farms
          SET legacy_turso_url = turso_url,
              legacy_turso_auth_token = turso_auth_token,
              turso_url = ?,
              turso_auth_token = ?
          WHERE slug = ?`,
    args: [newDb.url, newDb.token, args.slug],
  });

  // 6. Hint file so operator can invalidate any in-flight Lambda creds cache.
  const noteFile = join(workDir, "cutover-note.txt");
  writeFileSync(
    noteFile,
    `Farm: ${args.slug}
Old URL: ${farm.tursoUrl}
New URL: ${newDb.url}
At: ${new Date().toISOString()}
Next: bounce any running Vercel deployment to evict farm-creds-cache.
Rollback: pnpm tsx scripts/migrate-farm-to-frankfurt.ts --slug ${args.slug} --rollback
`,
  );
  console.log(`[phase-e] DONE. Notes at ${noteFile}`);
}

async function rollback(args: Args) {
  console.log(`[phase-e] ROLLBACK for farm "${args.slug}"`);
  const farm = await fetchFarm(args.slug);
  if (!farm.legacyTursoUrl || !farm.legacyTursoAuthToken) {
    console.error(`Error: no legacy URL stored for "${args.slug}" — nothing to roll back.`);
    process.exit(1);
  }
  console.log(`[phase-e] Restoring old URL: ${farm.legacyTursoUrl}`);
  if (args.dryRun) {
    console.log("[dry-run] would swap meta DB pointer back.");
    return;
  }
  const meta = getMetaClient();
  await meta.execute({
    sql: `UPDATE farms
          SET turso_url = legacy_turso_url,
              turso_auth_token = legacy_turso_auth_token,
              legacy_turso_url = NULL,
              legacy_turso_auth_token = NULL
          WHERE slug = ?`,
    args: [args.slug],
  });
  console.log(`[phase-e] Rollback complete.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.rollback) await rollback(args);
  else await migrate(args);
}

main().catch((err) => {
  console.error("[phase-e] Unhandled error:", err);
  process.exit(1);
});
