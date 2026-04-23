#!/usr/bin/env -S tsx
/**
 * bench-snapshot — write the headline numbers from an `lhci autorun`
 * into `tasks/bench/latest.json` plus a timestamped sibling so perf
 * diffs are one `diff` away.
 *
 * Called from the LHCI GitHub workflow (`.github/workflows/lhci.yml`)
 * after `lhci autorun` finishes. Reads `.lighthouseci/manifest.json`
 * + each representative run's audit JSON and distils the subset of
 * metrics we actually care about (FCP, LCP, TTI, total JS transfer,
 * performance score).
 *
 * Usage (from repo root):
 *   tsx scripts/bench-snapshot.ts [--lhci-dir=.lighthouseci] [--out=tasks/bench]
 *
 * Exits 0 on success (including "no manifest found" — that means LHCI
 * was skipped, not an error). Exits 1 on I/O failure.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────

export interface BenchRow {
  url: string;
  performance: number | null;
  fcp: number | null;
  lcp: number | null;
  tti: number | null;
  jsTransferBytes: number | null;
}

export interface BenchSnapshot {
  generatedAt: string;
  runs: BenchRow[];
}

interface LhciManifestEntry {
  url: string;
  isRepresentativeRun?: boolean;
  jsonPath: string;
  summary?: {
    performance?: number;
    "first-contentful-paint"?: number;
    "largest-contentful-paint"?: number;
    interactive?: number;
  };
}

interface LhciReport {
  audits?: {
    "resource-summary"?: {
      details?: {
        items?: Array<{ resourceType?: string; transferSize?: number }>;
      };
    };
  };
}

// ── Parser ──────────────────────────────────────────────────────────────

/**
 * Parse an `.lighthouseci/` directory into a flat array of one BenchRow
 * per representative URL. Non-representative runs (the non-median runs
 * in a 3-run batch) are dropped. Missing metrics are emitted as `null`
 * rather than silently coerced to 0.
 */
export function parseLhciManifest(lhciDir: string): BenchRow[] {
  const manifestPath = join(lhciDir, "manifest.json");
  if (!existsSync(manifestPath)) return [];

  let manifest: LhciManifestEntry[];
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return [];
  }

  const rows: BenchRow[] = [];
  for (const entry of manifest) {
    if (!entry.isRepresentativeRun) continue;
    const summary = entry.summary ?? {};

    let jsTransferBytes: number | null = null;
    try {
      const reportPath = join(lhciDir, entry.jsonPath);
      if (existsSync(reportPath)) {
        const report = JSON.parse(readFileSync(reportPath, "utf-8")) as LhciReport;
        const items = report.audits?.["resource-summary"]?.details?.items ?? [];
        const script = items.find((i) => i.resourceType === "script");
        if (script?.transferSize != null) jsTransferBytes = script.transferSize;
      }
    } catch {
      // Any per-report parse error is non-fatal — the summary is still useful.
    }

    rows.push({
      url: entry.url,
      performance: summary.performance ?? null,
      fcp: summary["first-contentful-paint"] ?? null,
      lcp: summary["largest-contentful-paint"] ?? null,
      tti: summary.interactive ?? null,
      jsTransferBytes,
    });
  }
  return rows;
}

// ── Writer ──────────────────────────────────────────────────────────────

/**
 * Create `latest.json` (overwriting) and a timestamped sibling in
 * `outDir`. Returns the snapshot that was written for testability.
 */
export function writeBenchSnapshot(outDir: string, rows: BenchRow[]): BenchSnapshot {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const snapshot: BenchSnapshot = {
    generatedAt: new Date().toISOString(),
    runs: rows,
  };
  const json = JSON.stringify(snapshot, null, 2);

  // Timestamped filename — replace colons so it's filesystem-friendly on
  // every OS (Windows chokes on them). Millisecond suffix prevents
  // collisions when two runs land in the same second.
  const safeTs = snapshot.generatedAt.replace(/:/g, "-");
  writeFileSync(join(outDir, `${safeTs}.json`), json);
  writeFileSync(join(outDir, "latest.json"), json);
  return snapshot;
}

// ── CLI entrypoint ──────────────────────────────────────────────────────

function parseArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function main(): void {
  const lhciDir = parseArg("lhci-dir", ".lighthouseci");
  const outDir = parseArg("out", "tasks/bench");

  const rows = parseLhciManifest(lhciDir);
  if (rows.length === 0) {
    console.warn(`[bench-snapshot] no manifest found at ${lhciDir} — nothing written.`);
    return;
  }

  const snapshot = writeBenchSnapshot(outDir, rows);
  console.log(
    `[bench-snapshot] wrote ${rows.length} run(s) to ${outDir}/latest.json (${snapshot.generatedAt})`,
  );
}

// Only run main when this file is executed directly. Avoids firing side
// effects when the module is imported (notably, by the test suite).
const isDirectRun =
  typeof import.meta.url === "string" &&
  (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith("bench-snapshot.ts") ||
    process.argv[1]?.endsWith("bench-snapshot.js"));
if (isDirectRun) {
  try {
    main();
  } catch (err) {
    console.error("[bench-snapshot] failed:", err);
    process.exit(1);
  }
}
