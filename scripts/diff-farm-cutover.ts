#!/usr/bin/env tsx
/**
 * diff-farm-cutover.ts — Permanent source↔target row-level diff tool.
 *
 * Promoted from /tmp/wave1-diff/diff-tenants.mjs (2026-04-25) which produced
 * the Phase-E data-recovery report (docs/ops/wave1-data-recovery-diff-2026-04-25.md).
 *
 * Usage:
 *   pnpm diff-farm-cutover -- --tenant <slug> [options]
 *
 * Options:
 *   --tenant <slug>          REQUIRED. Tenant slug to diff.
 *   --source-url <url>       Override source URL  (default: legacy_turso_url from meta DB)
 *   --source-token <token>   Override source token (default: legacy_turso_auth_token from meta DB)
 *   --target-url <url>       Override target URL  (default: turso_url from meta DB)
 *   --target-token <token>   Override target token (default: turso_auth_token from meta DB)
 *   --out <path>             JSON output path (default: docs/ops/diff-<tenant>-<YYYY-MM-DD>.json)
 *   --top-n <N>              Show top-N divergent rows (default: 10)
 *   --help                   Show this help and exit
 *
 * Exit codes:
 *   0 — No source-only rows on any application table (clean / post-cutover only)
 *   1 — One or more source-only rows detected (potential lost writes)
 *   2 — Argument, connection, or schema error (diff may be partial)
 *
 * Required env:
 *   META_TURSO_URL          URL of the FarmTrack meta DB
 *   META_TURSO_AUTH_TOKEN   Auth token for the meta DB
 *
 * Both source and target connections are READ-ONLY. Any non-SELECT query
 * is rejected at the safeRead() call boundary with code READ_ONLY_VIOLATION.
 */

import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TableSide {
  count: number;
  maxUpdatedAt: string | null;
  maxCreatedAt: string | null;
}

export interface TableDiff {
  name: string;
  src: TableSide;
  dst: TableSide;
  divergentRows: {
    onlyOnSrc: string[];
    onlyOnDst: string[];
  };
}

export interface SchemaMismatch {
  onlyOnSrc: string[];
  onlyOnDst: string[];
}

export interface DiffJsonOutput {
  tenant: string;
  source: string;
  target: string;
  generatedAt: string;
  schemaMismatch: SchemaMismatch | null;
  tables: TableDiff[];
}

export interface DiffResult {
  exitCode: 0 | 1 | 2;
  schemaMismatch: SchemaMismatch | null;
  divergentTables: TableDiff[];
  markdown: string;
  jsonOutput: DiffJsonOutput;
}

// Error code for the typed-error pattern (per silent-failure-pattern.md)
export class DiffError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "DiffError";
  }
}

// ── Read-only enforcement ─────────────────────────────────────────────────────

/**
 * Execute a SQL query against a libSQL client, asserting it is a SELECT.
 * Throws DiffError(READ_ONLY_VIOLATION) for any non-SELECT statement.
 * This is the single chokepoint for all DB reads in this script.
 */
export async function safeRead(
  client: Pick<Client, "execute">,
  sql: string,
  args?: (string | number | null)[],
): Promise<Record<string, unknown>[]> {
  const normalized = sql.trimStart().toLowerCase();
  if (!normalized.startsWith("select")) {
    throw new DiffError(
      "READ_ONLY_VIOLATION",
      `Only SELECT queries are allowed; got: ${sql.slice(0, 60)}`,
    );
  }
  const result = await client.execute({ sql, args: args ?? [] });
  return result.rows as Record<string, unknown>[];
}

// ── Table enumeration ─────────────────────────────────────────────────────────

const TABLE_ENUM_SQL = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '_migrations%'`;

export async function enumerateTables(
  client: Pick<Client, "execute">,
): Promise<string[]> {
  const rows = await safeRead(client, TABLE_ENUM_SQL);
  return rows.map((r) => r.name as string).sort();
}

// ── Column inspection ─────────────────────────────────────────────────────────

async function getColumnNames(
  client: Pick<Client, "execute">,
  table: string,
): Promise<string[]> {
  const rows = await safeRead(client, `SELECT name FROM pragma_table_info(?)`, [table]);
  return rows.map((r) => r.name as string);
}

// ── Per-table diff ────────────────────────────────────────────────────────────

/**
 * Diff a single table between source and target.
 * Reads count, max timestamps, and (when counts differ) full ID lists to compute
 * the symmetric set difference.
 */
export async function diffTable(
  src: Pick<Client, "execute">,
  dst: Pick<Client, "execute">,
  table: string,
  topN: number,
): Promise<TableDiff> {
  // Count
  const [srcCountRows, dstCountRows] = await Promise.all([
    safeRead(src, `SELECT COUNT(*) FROM "${table}"`),
    safeRead(dst, `SELECT COUNT(*) FROM "${table}"`),
  ]);
  const srcCount = Number(srcCountRows[0]?.["COUNT(*)"] ?? 0);
  const dstCount = Number(dstCountRows[0]?.["COUNT(*)"] ?? 0);

  // Timestamp columns (check on source — both sides should have same schema)
  const cols = await getColumnNames(src, table);
  const hasUpdatedAt = cols.includes("updatedAt");
  const hasCreatedAt = cols.includes("createdAt");
  const hasPkId = cols.includes("id");

  // Max timestamps
  let srcMaxUpdatedAt: string | null = null;
  let dstMaxUpdatedAt: string | null = null;
  let srcMaxCreatedAt: string | null = null;
  let dstMaxCreatedAt: string | null = null;

  if (hasUpdatedAt) {
    const [srcRows, dstRows] = await Promise.all([
      safeRead(src, `SELECT MAX(updatedAt) FROM "${table}"`),
      safeRead(dst, `SELECT MAX(updatedAt) FROM "${table}"`),
    ]);
    srcMaxUpdatedAt = (srcRows[0]?.["MAX(updatedAt)"] as string | null) ?? null;
    dstMaxUpdatedAt = (dstRows[0]?.["MAX(updatedAt)"] as string | null) ?? null;
  }

  if (hasCreatedAt) {
    const [srcRows, dstRows] = await Promise.all([
      safeRead(src, `SELECT MAX(createdAt) FROM "${table}"`),
      safeRead(dst, `SELECT MAX(createdAt) FROM "${table}"`),
    ]);
    srcMaxCreatedAt = (srcRows[0]?.["MAX(createdAt)"] as string | null) ?? null;
    dstMaxCreatedAt = (dstRows[0]?.["MAX(createdAt)"] as string | null) ?? null;
  }

  const srcSide: TableSide = {
    count: srcCount,
    maxUpdatedAt: srcMaxUpdatedAt,
    maxCreatedAt: srcMaxCreatedAt,
  };
  const dstSide: TableSide = {
    count: dstCount,
    maxUpdatedAt: dstMaxUpdatedAt,
    maxCreatedAt: dstMaxCreatedAt,
  };

  // Count parity and timestamp parity check
  const countDiffers = srcCount !== dstCount;
  const updatedAtDiffers = hasUpdatedAt && srcMaxUpdatedAt !== dstMaxUpdatedAt;
  const createdAtDiffers = hasCreatedAt && srcMaxCreatedAt !== dstMaxCreatedAt;
  const isDivergent = countDiffers || updatedAtDiffers || createdAtDiffers;

  let onlyOnSrc: string[] = [];
  let onlyOnDst: string[] = [];

  if (isDivergent && hasPkId) {
    // Pull full ID lists and compute symmetric set difference
    const [srcIdRows, dstIdRows] = await Promise.all([
      safeRead(src, `SELECT id FROM "${table}"`),
      safeRead(dst, `SELECT id FROM "${table}"`),
    ]);
    const srcIds = new Set(srcIdRows.map((r) => r.id as string));
    const dstIds = new Set(dstIdRows.map((r) => r.id as string));

    for (const id of srcIds) {
      if (!dstIds.has(id)) onlyOnSrc.push(id);
    }
    for (const id of dstIds) {
      if (!srcIds.has(id)) onlyOnDst.push(id);
    }

    // Respect topN cap
    if (onlyOnSrc.length > topN) onlyOnSrc = onlyOnSrc.slice(0, topN);
    if (onlyOnDst.length > topN) onlyOnDst = onlyOnDst.slice(0, topN);
  } else if (isDivergent && !hasPkId) {
    // Table has no `id` column — we can report counts diverged but can't ID the rows
    // Log a warning; the count diff will still appear in the output.
    process.stderr.write(
      `[warn] Table "${table}" has no 'id' PK column — row-level set-diff skipped\n`,
    );
  }

  return {
    name: table,
    src: srcSide,
    dst: dstSide,
    divergentRows: { onlyOnSrc, onlyOnDst },
  };
}

// ── Markdown formatter ────────────────────────────────────────────────────────

export function formatMarkdown(
  tenant: string,
  opts: {
    schemaMismatch: SchemaMismatch | null;
    divergentTables: TableDiff[];
    sourceUrl: string;
    targetUrl: string;
    generatedAt: string;
    totalTables: number;
  },
): string {
  const {
    schemaMismatch,
    divergentTables,
    sourceUrl,
    targetUrl,
    generatedAt,
    totalTables,
  } = opts;

  const lostWriteTables = divergentTables.filter(
    (t) => t.divergentRows.onlyOnSrc.length > 0,
  );
  const verdict =
    lostWriteTables.length === 0
      ? "NO LOST WRITES — no source-only rows detected"
      : `LOST WRITES DETECTED — ${lostWriteTables.length} table(s) have source-only rows`;

  const lines: string[] = [
    `# Cutover Diff Report — \`${tenant}\``,
    "",
    `**Generated:** ${generatedAt}`,
    `**Source:** \`${sourceUrl}\``,
    `**Target:** \`${targetUrl}\``,
    `**Tables compared:** ${totalTables}${schemaMismatch ? ` (intersection; schema drift detected)` : ""}`,
    `**Tables diverged:** ${divergentTables.length}`,
    `**Verdict:** ${verdict}`,
    "",
  ];

  if (schemaMismatch) {
    lines.push("## Schema mismatch");
    lines.push("");
    if (schemaMismatch.onlyOnSrc.length > 0) {
      lines.push(`Tables only on **source**: ${schemaMismatch.onlyOnSrc.join(", ")}`);
    }
    if (schemaMismatch.onlyOnDst.length > 0) {
      lines.push(`Tables only on **target**: ${schemaMismatch.onlyOnDst.join(", ")}`);
    }
    lines.push("");
  }

  if (divergentTables.length === 0) {
    lines.push("All compared tables are in parity (counts and max-timestamps identical).");
  } else {
    lines.push("## Divergent table summary");
    lines.push("");
    lines.push("| Table | src count | dst count | delta | src max(updatedAt) | dst max(updatedAt) | src-only rows | dst-only rows |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const t of divergentTables) {
      const delta = t.dst.count - t.src.count;
      lines.push(
        `| \`${t.name}\` | ${t.src.count} | ${t.dst.count} | ${delta >= 0 ? "+" : ""}${delta} | ${t.src.maxUpdatedAt ?? "—"} | ${t.dst.maxUpdatedAt ?? "—"} | ${t.divergentRows.onlyOnSrc.length} | ${t.divergentRows.onlyOnDst.length} |`,
      );
    }
    lines.push("");

    for (const t of divergentTables) {
      if (t.divergentRows.onlyOnSrc.length > 0) {
        lines.push(`### \`${t.name}\` — source-only rows (POTENTIAL LOST WRITES)`);
        lines.push("");
        for (const id of t.divergentRows.onlyOnSrc) {
          lines.push(`- \`${id}\``);
        }
        lines.push("");
      }
      if (t.divergentRows.onlyOnDst.length > 0) {
        lines.push(`### \`${t.name}\` — target-only rows (post-cutover writes)`);
        lines.push("");
        for (const id of t.divergentRows.onlyOnDst) {
          lines.push(`- \`${id}\``);
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

// ── Core diff orchestration ───────────────────────────────────────────────────

export interface RunDiffOptions {
  sourceUrl: string;
  sourceToken: string;
  targetUrl: string;
  targetToken: string;
  tenant: string;
  outPath?: string;
  topN?: number;
}

export async function runDiff(opts: RunDiffOptions): Promise<DiffResult> {
  const {
    sourceUrl,
    sourceToken,
    targetUrl,
    targetToken,
    tenant,
    topN = 10,
  } = opts;

  const generatedAt = new Date().toISOString();

  const src = createClient({ url: sourceUrl, authToken: sourceToken });
  const dst = createClient({ url: targetUrl, authToken: targetToken });

  // 1. Enumerate tables on both sides
  const [srcTables, dstTables] = await Promise.all([
    enumerateTables(src),
    enumerateTables(dst),
  ]);

  const srcSet = new Set(srcTables);
  const dstSet = new Set(dstTables);

  const onlyOnSrcSchema = srcTables.filter((t) => !dstSet.has(t));
  const onlyOnDstSchema = dstTables.filter((t) => !srcSet.has(t));
  const schemaMismatch: SchemaMismatch | null =
    onlyOnSrcSchema.length > 0 || onlyOnDstSchema.length > 0
      ? { onlyOnSrc: onlyOnSrcSchema, onlyOnDst: onlyOnDstSchema }
      : null;

  const intersection = srcTables.filter((t) => dstSet.has(t));

  // 2. Diff each table in the intersection
  const allTableResults = await Promise.all(
    intersection.map((table) => diffTable(src, dst, table, topN)),
  );

  // 3. Filter to only divergent tables for the report
  const divergentTables = allTableResults.filter(
    (t) =>
      t.src.count !== t.dst.count ||
      t.src.maxUpdatedAt !== t.dst.maxUpdatedAt ||
      t.src.maxCreatedAt !== t.dst.maxCreatedAt,
  );

  // 4. Determine exit code
  const hasLostWrites = divergentTables.some(
    (t) => t.divergentRows.onlyOnSrc.length > 0,
  );
  const exitCode: 0 | 1 | 2 = schemaMismatch
    ? 2
    : hasLostWrites
      ? 1
      : 0;

  // 5. Build JSON output
  const jsonOutput: DiffJsonOutput = {
    tenant,
    source: sourceUrl,
    target: targetUrl,
    generatedAt,
    schemaMismatch,
    tables: allTableResults,
  };

  // 6. Build Markdown
  const markdown = formatMarkdown(tenant, {
    schemaMismatch,
    divergentTables,
    sourceUrl,
    targetUrl,
    generatedAt,
    totalTables: intersection.length,
  });

  // 7. Write JSON file
  const outPath =
    opts.outPath ??
    `docs/ops/diff-${tenant}-${generatedAt.slice(0, 10)}.json`;

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(jsonOutput, null, 2), "utf-8");

  return { exitCode, schemaMismatch, divergentTables, markdown, jsonOutput };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

const HELP = `
Usage: pnpm diff-farm-cutover -- --tenant <slug> [options]

Options:
  --tenant <slug>          REQUIRED. Tenant slug to diff.
  --source-url <url>       Override source URL  (default: legacy_turso_url from meta DB)
  --source-token <token>   Override source token (default: legacy_turso_auth_token from meta DB)
  --target-url <url>       Override target URL  (default: turso_url from meta DB)
  --target-token <token>   Override target token (default: turso_auth_token from meta DB)
  --out <path>             JSON output path (default: docs/ops/diff-<tenant>-<YYYY-MM-DD>.json)
  --top-n <N>              Show top-N divergent rows per side (default: 10)
  --help                   Show this help and exit

Required env:
  META_TURSO_URL            URL of the FarmTrack meta DB
  META_TURSO_AUTH_TOKEN     Auth token for the meta DB

Exit codes:
  0  No source-only rows on any application table (clean / post-cutover only)
  1  One or more source-only rows detected (potential lost writes)
  2  Argument, connection, or schema error (diff may be partial)

Example:
  pnpm diff-farm-cutover -- --tenant trio-b-boerdery
  pnpm diff-farm-cutover -- --tenant trio-b-boerdery --out /tmp/diff-result.json
`.trim();

async function parseArgs(): Promise<{
  tenant: string;
  sourceUrl?: string;
  sourceToken?: string;
  targetUrl?: string;
  targetToken?: string;
  outPath?: string;
  topN: number;
}> {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  function flag(name: string): string | undefined {
    const idx = argv.indexOf(name);
    if (idx === -1) return undefined;
    const val = argv[idx + 1];
    if (!val || val.startsWith("--")) {
      throw new DiffError("MISSING_ARG_VALUE", `Flag ${name} requires a value`);
    }
    return val;
  }

  const tenant = flag("--tenant");
  if (!tenant) {
    throw new DiffError("MISSING_REQUIRED_ARG", "--tenant <slug> is required");
  }

  const topNRaw = flag("--top-n");
  const topN = topNRaw != null ? parseInt(topNRaw, 10) : 10;
  if (isNaN(topN) || topN < 1) {
    throw new DiffError("INVALID_ARG", "--top-n must be a positive integer");
  }

  return {
    tenant,
    sourceUrl: flag("--source-url"),
    sourceToken: flag("--source-token"),
    targetUrl: flag("--target-url"),
    targetToken: flag("--target-token"),
    outPath: flag("--out"),
    topN,
  };
}

async function resolveFarmCreds(tenant: string): Promise<{
  legacyUrl: string;
  legacyToken: string;
  currentUrl: string;
  currentToken: string;
}> {
  const metaUrl = process.env.META_TURSO_URL;
  const metaToken = process.env.META_TURSO_AUTH_TOKEN;
  if (!metaUrl || !metaToken) {
    throw new DiffError(
      "MISSING_ENV",
      "META_TURSO_URL and META_TURSO_AUTH_TOKEN must be set",
    );
  }
  const meta = createClient({ url: metaUrl, authToken: metaToken });
  const rows = await safeRead(
    meta,
    `SELECT turso_url, turso_auth_token, legacy_turso_url, legacy_turso_auth_token FROM farms WHERE slug = ?`,
    [tenant],
  );
  if (rows.length === 0) {
    throw new DiffError("TENANT_NOT_FOUND", `No farm found with slug: ${tenant}`);
  }
  const row = rows[0];
  const legacyUrl = row.legacy_turso_url as string | null;
  const legacyToken = row.legacy_turso_auth_token as string | null;
  if (!legacyUrl || !legacyToken) {
    throw new DiffError(
      "NO_LEGACY_CREDS",
      `Farm "${tenant}" has no legacy_turso_url — has Phase E migration already been completed and cleared?`,
    );
  }
  return {
    legacyUrl,
    legacyToken,
    currentUrl: row.turso_url as string,
    currentToken: row.turso_auth_token as string,
  };
}

// Only run main when this file is the entry point (not when imported by tests)
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("diff-farm-cutover.ts") ||
    process.argv[1].endsWith("diff-farm-cutover.js"));

if (isMain) {
  (async () => {
    let args: Awaited<ReturnType<typeof parseArgs>>;
    try {
      args = await parseArgs();
    } catch (err) {
      console.error((err as Error).message);
      process.exit(2);
    }

    let sourceUrl: string;
    let sourceToken: string;
    let targetUrl: string;
    let targetToken: string;

    if (args.sourceUrl && args.sourceToken && args.targetUrl && args.targetToken) {
      sourceUrl = args.sourceUrl;
      sourceToken = args.sourceToken;
      targetUrl = args.targetUrl;
      targetToken = args.targetToken;
    } else {
      try {
        const creds = await resolveFarmCreds(args.tenant);
        sourceUrl = args.sourceUrl ?? creds.legacyUrl;
        sourceToken = args.sourceToken ?? creds.legacyToken;
        targetUrl = args.targetUrl ?? creds.currentUrl;
        targetToken = args.targetToken ?? creds.currentToken;
      } catch (err) {
        console.error((err as Error).message);
        process.exit(2);
      }
    }

    try {
      const result = await runDiff({
        sourceUrl: sourceUrl!,
        sourceToken: sourceToken!,
        targetUrl: targetUrl!,
        targetToken: targetToken!,
        tenant: args.tenant,
        outPath: args.outPath,
        topN: args.topN,
      });

      process.stdout.write(result.markdown + "\n");
      const outPath =
        args.outPath ??
        `docs/ops/diff-${args.tenant}-${new Date().toISOString().slice(0, 10)}.json`;
      console.error(`\n[diff-farm-cutover] JSON written to: ${outPath}`);
      console.error(
        `[diff-farm-cutover] Exit code: ${result.exitCode} (${
          result.exitCode === 0
            ? "no lost writes"
            : result.exitCode === 1
              ? "LOST WRITES DETECTED"
              : "schema/connection error"
        })`,
      );
      process.exit(result.exitCode);
    } catch (err) {
      console.error("[diff-farm-cutover] Fatal error:", (err as Error).message);
      process.exit(2);
    }
  })();
}
