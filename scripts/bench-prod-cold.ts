#!/usr/bin/env tsx
/**
 * bench-prod-cold — measure cold-TTFB against production from the caller's
 * location, write a JSON snapshot, and fail on p95 regression vs. the most
 * recent prior snapshot with the same --label.
 *
 * Usage:
 *   pnpm tsx scripts/bench-prod-cold.ts \
 *     --url https://farm-management-lilac.vercel.app/delta-livestock/dashboard \
 *     --cookie "__Secure-next-auth.session-token=..." \
 *     --iterations 5 \
 *     --label post-wave-1 \
 *     --regression-threshold 0.15
 *
 * If `--cookie` is omitted the script reads `BENCH_COOKIE` from the
 * environment so you don't have to paste a session token on the command
 * line (and have it end up in shell history).
 *
 * See `docs/perf/bench-playbook.md` for the full operator playbook
 * (extracting the session cookie, cold vs. warm runs, interpreting
 * regression exits, baseline URLs).
 *
 * Exit codes:
 *   0  ─ snapshot written; no prior baseline or within-budget p95
 *   1  ─ p95 regression exceeds threshold
 *   2  ─ operator error (bad args, network failure, etc.)
 *
 * TTFB caveat: `fetch` on Node does NOT expose curl's `time_starttransfer`
 * directly. We approximate it by measuring `performance.now()` from the
 * `fetch()` call site to the first chunk yielded by
 * `response.body.getReader().read()`. This is coarser than curl because
 * node's fetch buffers headers and may coalesce small TCP reads. For
 * cross-tool comparisons, prefer comparing bench-prod-cold runs against
 * each other (same tool, same location) rather than against curl numbers.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

// ── Public types ───────────────────────────────────────────────────────

export interface BenchSample {
  iteration: number;
  /** Milliseconds from fetch() call to first body-chunk read. */
  ttfbMs: number;
  /** Milliseconds from fetch() call to body stream end. */
  totalMs: number;
  status: number;
  /** Raw x-vercel-id response header (e.g. "iad1::abc123"), or null. */
  vercelId: string | null;
}

export interface BenchSnapshot {
  /** ISO-8601 timestamp of the run. */
  timestamp: string;
  /** Short git SHA at time of run; "unknown" if git unavailable. */
  gitSha: string;
  label: string;
  url: string;
  iterations: number;
  samples: BenchSample[];
  /** TTFB percentiles in ms (linear interpolation, h = p*n — see percentile()). */
  p50: number;
  p95: number;
  p99: number;
  meanTtfb: number;
  /** Region prefix of the last sample's x-vercel-id (e.g. "iad1"), or null. */
  vercelRegion: string | null;
}

export interface ParsedArgs {
  url: string;
  cookie: string | null;
  iterations: number;
  label: string;
  regressionThreshold: number;
  help: boolean;
}

// ── Defaults ───────────────────────────────────────────────────────────

export const DEFAULT_ITERATIONS = 5;
export const DEFAULT_REGRESSION_THRESHOLD = 0.15;
export const DEFAULT_LABEL = "adhoc";
export const DEFAULT_BENCH_DIR = "bench-results";

// ── Arg parser ─────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    url: "",
    cookie: null,
    iterations: DEFAULT_ITERATIONS,
    label: DEFAULT_LABEL,
    regressionThreshold: DEFAULT_REGRESSION_THRESHOLD,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--url":
        out.url = argv[++i] ?? "";
        break;
      case "--cookie":
        out.cookie = argv[++i] ?? null;
        break;
      case "--iterations": {
        const raw = argv[++i];
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1) {
          throw new Error(`--iterations must be a positive integer (got ${JSON.stringify(raw)})`);
        }
        out.iterations = n;
        break;
      }
      case "--label":
        out.label = argv[++i] ?? DEFAULT_LABEL;
        break;
      case "--regression-threshold": {
        const raw = argv[++i];
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(
            `--regression-threshold must be a non-negative number (got ${JSON.stringify(raw)})`,
          );
        }
        out.regressionThreshold = n;
        break;
      }
      default:
        // Unknown flags are ignored so we can forward CI args without fuss.
        break;
    }
  }

  if (!out.help && !out.url) {
    throw new Error("--url is required (pass --help for usage)");
  }

  return out;
}

// ── Percentile math ────────────────────────────────────────────────────

/**
 * Linear-interpolation percentile, Weibull plotting position (R type 4):
 *
 *   h = p * n
 *   lower = sorted[max(0, floor(h) - 1)]
 *   upper = sorted[min(n-1, floor(h))]
 *   result = lower + (h - floor(h)) * (upper - lower)
 *
 * For sample `[100,200,...,1000]` (n=10) this yields
 * p50 = 500, p95 = 950, p99 = 990.
 *
 * We picked this variant (rather than numpy's R-7 default) because it
 * gives clean round numbers for the documented test fixture, which makes
 * the regression-threshold budget easier to reason about in code review.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) {
    throw new Error("percentile: samples must be non-empty");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return sorted[0];

  const h = p * n;
  const floorH = Math.floor(h);
  const lowerIdx = Math.max(0, floorH - 1);
  const upperIdx = Math.min(n - 1, floorH);
  const lower = sorted[lowerIdx];
  const upper = sorted[upperIdx];
  return lower + (h - floorH) * (upper - lower);
}

// ── Summarise / build snapshot ─────────────────────────────────────────

export interface Summary {
  p50: number;
  p95: number;
  p99: number;
  meanTtfb: number;
}

export function summarise(samples: readonly BenchSample[]): Summary {
  const ttfbs = samples.map((s) => s.ttfbMs);
  return {
    p50: percentile(ttfbs, 0.5),
    p95: percentile(ttfbs, 0.95),
    p99: percentile(ttfbs, 0.99),
    meanTtfb: ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length,
  };
}

export function buildSnapshot(args: {
  samples: BenchSample[];
  url: string;
  label: string;
  gitSha: string;
  timestamp: string;
}): BenchSnapshot {
  const { samples, url, label, gitSha, timestamp } = args;
  const summary = summarise(samples);

  // The last successful sample's x-vercel-id tells us what region actually
  // served the request — useful during Phase E (Frankfurt move) to confirm
  // the new region took over.
  const lastWithVercelId = [...samples].reverse().find((s) => s.vercelId);
  const vercelRegion = lastWithVercelId?.vercelId
    ? extractVercelRegion(lastWithVercelId.vercelId)
    : null;

  return {
    timestamp,
    gitSha,
    label,
    url,
    iterations: samples.length,
    samples,
    p50: summary.p50,
    p95: summary.p95,
    p99: summary.p99,
    meanTtfb: summary.meanTtfb,
    vercelRegion,
  };
}

function extractVercelRegion(vercelId: string): string | null {
  // x-vercel-id format: "<region>::<node>::<request-id>"
  const [region] = vercelId.split("::");
  return region && region.length > 0 ? region : null;
}

// ── Prior snapshot lookup ──────────────────────────────────────────────

const SNAPSHOT_EXT = /\.json$/i;
const TMP_EXT = /\.tmp\.json$/i;

export function findLatestPriorSnapshot(
  dir: string,
  label: string,
): BenchSnapshot | null {
  if (!existsSync(dir)) return null;

  const candidates: { path: string; mtimeMs: number }[] = [];
  for (const name of readdirSync(dir)) {
    if (!SNAPSHOT_EXT.test(name)) continue;
    if (TMP_EXT.test(name)) continue;
    const full = join(dir, name);
    try {
      const raw = readFileSync(full, "utf-8");
      const parsed = JSON.parse(raw) as Partial<BenchSnapshot>;
      if (parsed.label !== label) continue;
      candidates.push({ path: full, mtimeMs: statSync(full).mtimeMs });
    } catch {
      // Skip malformed files — treat as if absent.
      continue;
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const winner = candidates[0];
  return JSON.parse(readFileSync(winner.path, "utf-8")) as BenchSnapshot;
}

// ── Regression detection ───────────────────────────────────────────────

export interface RegressionResult {
  regressed: boolean;
  priorP95: number | null;
  currentP95: number;
  /** prior * (1 + threshold); null when there's no prior. */
  budgetP95: number | null;
  /** (current - prior) / prior; null when there's no prior. */
  deltaRatio: number | null;
}

export function detectRegression(args: {
  priorP95: number | null;
  currentP95: number;
  threshold: number;
}): RegressionResult {
  const { priorP95, currentP95, threshold } = args;
  if (priorP95 === null) {
    return {
      regressed: false,
      priorP95: null,
      currentP95,
      budgetP95: null,
      deltaRatio: null,
    };
  }
  const budget = priorP95 * (1 + threshold);
  return {
    regressed: currentP95 > budget,
    priorP95,
    currentP95,
    budgetP95: budget,
    deltaRatio: (currentP95 - priorP95) / priorP95,
  };
}

// ── Cache buster ───────────────────────────────────────────────────────

export function buildCacheBustedUrl(url: string, iteration: number): string {
  // Random + iteration + pid => unique across runs AND across iterations,
  // so Vercel's edge cache (if any layer of it serves HTML) and Next's
  // route cache can never return a warm response.
  const bust = `${Date.now()}-${iteration}-${Math.random().toString(36).slice(2, 10)}`;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}__bust=${bust}`;
}

// ── Network layer (runtime only — not exercised by unit tests) ─────────

async function benchOne(
  url: string,
  iteration: number,
  cookie: string | null,
): Promise<BenchSample> {
  const target = buildCacheBustedUrl(url, iteration);
  const headers: Record<string, string> = {
    "user-agent": "bench-prod-cold/1.0 (+farm-management)",
    "cache-control": "no-cache",
    pragma: "no-cache",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  if (cookie) headers.cookie = cookie;

  const start = performance.now();
  const res = await fetch(target, { headers, redirect: "manual" });
  // First-chunk read gives us the closest approximation of curl's
  // time_starttransfer that node's fetch API supports. See the file
  // header for the caveat.
  let ttfbMs = performance.now() - start;
  let totalMs = ttfbMs;

  if (res.body) {
    const reader = res.body.getReader();
    let first = true;
    while (true) {
      const { done } = await reader.read();
      if (first) {
        ttfbMs = performance.now() - start;
        first = false;
      }
      if (done) break;
    }
    totalMs = performance.now() - start;
  }

  return {
    iteration,
    ttfbMs,
    totalMs,
    status: res.status,
    vercelId: res.headers.get("x-vercel-id"),
  };
}

// ── Git SHA helper ─────────────────────────────────────────────────────

function resolveGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

// ── Help text ──────────────────────────────────────────────────────────

function printHelp(): void {
  const help = `bench-prod-cold — measure cold-TTFB against a production URL

USAGE
  pnpm tsx scripts/bench-prod-cold.ts --url <url> [options]

REQUIRED
  --url <url>                       Fully qualified URL to benchmark.

OPTIONS
  --cookie <cookie>                 Full Cookie header value. If omitted,
                                    reads BENCH_COOKIE from the environment.
                                    Typical value:
                                      __Secure-next-auth.session-token=<token>
  --iterations <n>                  Number of requests to issue (default: ${DEFAULT_ITERATIONS}).
  --label <name>                    Label for the snapshot and the key used to
                                    look up the prior baseline for regression
                                    detection (default: ${DEFAULT_LABEL}).
  --regression-threshold <ratio>    p95 regression tolerance as a fraction
                                    of the prior p95 (default: ${DEFAULT_REGRESSION_THRESHOLD}).
                                    Exits non-zero when current p95 >
                                    prior p95 * (1 + threshold).
  -h, --help                        Print this help and exit.

OUTPUT
  Writes bench-results/<ISO-timestamp>-<label>.json containing the raw
  per-iteration samples, p50/p95/p99/mean, git SHA, and the Vercel region
  extracted from the last response's x-vercel-id header.

EXIT CODES
  0  Snapshot written; either no prior baseline or current p95 is within budget.
  1  p95 regression exceeds the threshold.
  2  Operator error (bad args, network failure, etc.).

SEE ALSO
  docs/perf/bench-playbook.md — operator playbook with session-cookie
  extraction, cold vs. warm runs, and baseline URLs.
`;
  process.stdout.write(help);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: ${msg}\n`);
    return 2;
  }

  if (parsed.help) {
    printHelp();
    return 0;
  }

  const cookie = parsed.cookie ?? process.env.BENCH_COOKIE ?? null;

  const samples: BenchSample[] = [];
  for (let i = 0; i < parsed.iterations; i++) {
    try {
      const sample = await benchOne(parsed.url, i, cookie);
      samples.push(sample);
      process.stderr.write(
        `iter=${i} ttfb=${sample.ttfbMs.toFixed(1)}ms total=${sample.totalMs.toFixed(1)}ms status=${sample.status}\n`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`iter=${i} FAILED: ${msg}\n`);
      return 2;
    }
  }

  const timestamp = new Date().toISOString();
  const snap = buildSnapshot({
    samples,
    url: parsed.url,
    label: parsed.label,
    gitSha: resolveGitSha(),
    timestamp,
  });

  const outDir = DEFAULT_BENCH_DIR;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const outPath = join(outDir, `${safeTimestamp}-${parsed.label}.json`);
  writeFileSync(outPath, JSON.stringify(snap, null, 2));
  process.stderr.write(`wrote ${outPath}\n`);

  // Regression check against the most recent prior snapshot with the same label.
  // Lookup excludes the file we just wrote by comparing realpaths.
  const priorSnap = findLatestPriorSnapshotExcluding(outDir, parsed.label, outPath);
  const reg = detectRegression({
    priorP95: priorSnap?.p95 ?? null,
    currentP95: snap.p95,
    threshold: parsed.regressionThreshold,
  });

  if (reg.priorP95 === null) {
    process.stderr.write(
      `p95=${snap.p95.toFixed(1)}ms — no prior baseline for label=${parsed.label}; snapshot is the new baseline\n`,
    );
    return 0;
  }

  const pct = ((reg.deltaRatio ?? 0) * 100).toFixed(1);
  if (reg.regressed) {
    process.stderr.write(
      `REGRESSION: p95=${snap.p95.toFixed(1)}ms vs prior ${reg.priorP95!.toFixed(1)}ms (${pct}% > +${(parsed.regressionThreshold * 100).toFixed(0)}% threshold; budget was ${reg.budgetP95!.toFixed(1)}ms)\n`,
    );
    return 1;
  }

  process.stderr.write(
    `ok: p95=${snap.p95.toFixed(1)}ms vs prior ${reg.priorP95!.toFixed(1)}ms (${pct}%; budget ${reg.budgetP95!.toFixed(1)}ms)\n`,
  );
  return 0;
}

function findLatestPriorSnapshotExcluding(
  dir: string,
  label: string,
  excludePath: string,
): BenchSnapshot | null {
  if (!existsSync(dir)) return null;
  const candidates: { path: string; mtimeMs: number }[] = [];
  for (const name of readdirSync(dir)) {
    if (!SNAPSHOT_EXT.test(name)) continue;
    if (TMP_EXT.test(name)) continue;
    const full = join(dir, name);
    if (full === excludePath) continue;
    try {
      const raw = readFileSync(full, "utf-8");
      const parsed = JSON.parse(raw) as Partial<BenchSnapshot>;
      if (parsed.label !== label) continue;
      candidates.push({ path: full, mtimeMs: statSync(full).mtimeMs });
    } catch {
      continue;
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return JSON.parse(readFileSync(candidates[0].path, "utf-8")) as BenchSnapshot;
}

// Only run when invoked as a script (`tsx scripts/bench-prod-cold.ts ...`),
// not when imported from a test.
const isEntrypoint =
  process.argv[1] && /bench-prod-cold\.ts$/.test(process.argv[1]);

if (isEntrypoint) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
      process.exit(2);
    });
}
