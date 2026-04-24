// @vitest-environment node
/**
 * scripts/bench-prod-cold.ts — drives N authenticated cache-busted requests
 * against a production URL, captures TTFB + total per-request timings,
 * writes a JSON snapshot to `bench-results/<iso>-<label>.json`, and
 * compares p95 against the most recent prior snapshot for regression
 * detection.
 *
 * These tests exercise the pure-function layer (CLI parser, percentile
 * math, snapshot shape, regression comparator) without touching the
 * network — the fetch layer is integration-tested by running `--help`
 * in the verify step. No real prod URL is hit from CI.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArgs,
  percentile,
  summarise,
  buildSnapshot,
  findLatestPriorSnapshot,
  detectRegression,
  DEFAULT_ITERATIONS,
  DEFAULT_REGRESSION_THRESHOLD,
  type BenchSample,
  type BenchSnapshot,
} from "../../scripts/bench-prod-cold";

// ── parseArgs ──────────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("parses --url, --cookie, --iterations, --label, --regression-threshold", () => {
    const parsed = parseArgs([
      "--url",
      "https://farm-management-lilac.vercel.app/delta-livestock/dashboard",
      "--cookie",
      "__Secure-next-auth.session-token=abc",
      "--iterations",
      "7",
      "--label",
      "post-wave-1",
      "--regression-threshold",
      "0.2",
    ]);
    expect(parsed.url).toBe(
      "https://farm-management-lilac.vercel.app/delta-livestock/dashboard",
    );
    expect(parsed.cookie).toBe("__Secure-next-auth.session-token=abc");
    expect(parsed.iterations).toBe(7);
    expect(parsed.label).toBe("post-wave-1");
    expect(parsed.regressionThreshold).toBeCloseTo(0.2);
    expect(parsed.help).toBe(false);
  });

  it("applies defaults for iterations and regression-threshold", () => {
    const parsed = parseArgs(["--url", "https://example.com"]);
    expect(parsed.iterations).toBe(DEFAULT_ITERATIONS);
    expect(parsed.regressionThreshold).toBeCloseTo(DEFAULT_REGRESSION_THRESHOLD);
  });

  it("defaults iterations to 5 and regression-threshold to 0.15", () => {
    // Pin the documented defaults so they can't drift silently.
    expect(DEFAULT_ITERATIONS).toBe(5);
    expect(DEFAULT_REGRESSION_THRESHOLD).toBeCloseTo(0.15);
  });

  it("sets help=true for --help", () => {
    const parsed = parseArgs(["--help"]);
    expect(parsed.help).toBe(true);
  });

  it("sets help=true for -h shorthand", () => {
    const parsed = parseArgs(["-h"]);
    expect(parsed.help).toBe(true);
  });

  it("throws when --iterations is not a positive integer", () => {
    expect(() => parseArgs(["--url", "https://x", "--iterations", "0"]))
      .toThrow(/iterations/);
    expect(() => parseArgs(["--url", "https://x", "--iterations", "-1"]))
      .toThrow(/iterations/);
    expect(() => parseArgs(["--url", "https://x", "--iterations", "abc"]))
      .toThrow(/iterations/);
  });

  it("throws when --regression-threshold is not a non-negative number", () => {
    expect(() => parseArgs(["--url", "https://x", "--regression-threshold", "-0.1"]))
      .toThrow(/regression-threshold/);
    expect(() => parseArgs(["--url", "https://x", "--regression-threshold", "abc"]))
      .toThrow(/regression-threshold/);
  });

  it("throws when --url is missing (and --help not passed)", () => {
    expect(() => parseArgs([])).toThrow(/--url/);
  });
});

// ── percentile ─────────────────────────────────────────────────────────

describe("percentile (linear-interpolation, h = p * n)", () => {
  // Method: sort ascending, h = p * n, lower = s[max(0,floor(h)-1)],
  // upper = s[min(n-1,floor(h))], result = lower + (h - floor(h)) * (upper-lower).
  // This is the Weibull plotting-position variant (R type 4). Documented in
  // the playbook so future readers don't have to reverse-engineer the math.
  const SAMPLE = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

  it("p50 of [100..1000] is 500", () => {
    expect(percentile(SAMPLE, 0.5)).toBeCloseTo(500);
  });

  it("p95 of [100..1000] is 950", () => {
    expect(percentile(SAMPLE, 0.95)).toBeCloseTo(950);
  });

  it("p99 of [100..1000] is 990", () => {
    expect(percentile(SAMPLE, 0.99)).toBeCloseTo(990);
  });

  it("is insensitive to input order (sorts internally)", () => {
    const shuffled = [1000, 100, 500, 300, 700, 200, 800, 400, 900, 600];
    expect(percentile(shuffled, 0.95)).toBeCloseTo(950);
  });

  it("returns the single value for n=1", () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.95)).toBe(42);
  });

  it("throws on empty input", () => {
    expect(() => percentile([], 0.5)).toThrow();
  });
});

// ── summarise ─────────────────────────────────────────────────────────

describe("summarise", () => {
  it("computes p50/p95/p99/mean from TTFB samples", () => {
    const samples: BenchSample[] = Array.from({ length: 10 }, (_, i) => ({
      iteration: i,
      ttfbMs: (i + 1) * 100, // 100..1000
      totalMs: (i + 1) * 150,
      status: 200,
      vercelId: "iad1::abc",
    }));

    const s = summarise(samples);
    expect(s.p50).toBeCloseTo(500);
    expect(s.p95).toBeCloseTo(950);
    expect(s.p99).toBeCloseTo(990);
    // mean of 100..1000 step 100 = 550
    expect(s.meanTtfb).toBeCloseTo(550);
  });
});

// ── buildSnapshot ─────────────────────────────────────────────────────

describe("buildSnapshot", () => {
  it("returns a snapshot with the documented shape", () => {
    const samples: BenchSample[] = [
      { iteration: 0, ttfbMs: 100, totalMs: 200, status: 200, vercelId: "iad1::a" },
      { iteration: 1, ttfbMs: 200, totalMs: 300, status: 200, vercelId: "iad1::b" },
    ];

    const snap = buildSnapshot({
      samples,
      url: "https://example.com/x",
      label: "unit-test",
      gitSha: "deadbeef",
      timestamp: "2026-04-23T00:00:00.000Z",
    });

    expect(snap.timestamp).toBe("2026-04-23T00:00:00.000Z");
    expect(snap.gitSha).toBe("deadbeef");
    expect(snap.label).toBe("unit-test");
    expect(snap.url).toBe("https://example.com/x");
    expect(snap.iterations).toBe(2);
    expect(snap.samples).toEqual(samples);
    expect(typeof snap.p50).toBe("number");
    expect(typeof snap.p95).toBe("number");
    expect(typeof snap.p99).toBe("number");
    expect(typeof snap.meanTtfb).toBe("number");
    // Most recent Vercel region wins (last sample's x-vercel-id prefix).
    expect(snap.vercelRegion).toBe("iad1");
  });

  it("handles missing x-vercel-id gracefully (null region)", () => {
    const samples: BenchSample[] = [
      { iteration: 0, ttfbMs: 100, totalMs: 200, status: 200, vercelId: null },
    ];
    const snap = buildSnapshot({
      samples,
      url: "https://example.com/x",
      label: "x",
      gitSha: "sha",
      timestamp: "2026-04-23T00:00:00.000Z",
    });
    expect(snap.vercelRegion).toBeNull();
  });
});

// ── findLatestPriorSnapshot / detectRegression ────────────────────────

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "bench-prod-cold-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeSnapshot(dir: string, filename: string, snap: Partial<BenchSnapshot>): void {
  const full: BenchSnapshot = {
    timestamp: "2026-04-01T00:00:00.000Z",
    gitSha: "prior",
    label: "prior",
    url: "https://example.com/x",
    iterations: 1,
    samples: [],
    p50: 0,
    p95: 0,
    p99: 0,
    meanTtfb: 0,
    vercelRegion: null,
    ...snap,
  };
  writeFileSync(join(dir, filename), JSON.stringify(full, null, 2));
}

describe("findLatestPriorSnapshot", () => {
  it("returns the most recently modified snapshot matching the label", () => {
    writeSnapshot(tmp, "2026-04-01-post-wave-1.json", { p95: 500, label: "post-wave-1" });
    // Ensure differing mtimes even on fast filesystems.
    const laterPath = join(tmp, "2026-04-02-post-wave-1.json");
    writeSnapshot(tmp, "2026-04-02-post-wave-1.json", { p95: 600, label: "post-wave-1" });
    // Touch `laterPath` slightly in the future.
    const future = new Date(Date.now() + 5000);
    // utimesSync via fs/promises equivalent.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { utimesSync } = require("node:fs");
    utimesSync(laterPath, future, future);

    const prior = findLatestPriorSnapshot(tmp, "post-wave-1");
    expect(prior?.p95).toBe(600);
  });

  it("ignores snapshots with a different label", () => {
    writeSnapshot(tmp, "2026-04-01-post-wave-2.json", { p95: 500, label: "post-wave-2" });
    const prior = findLatestPriorSnapshot(tmp, "post-wave-1");
    expect(prior).toBeNull();
  });

  it("ignores non-JSON files and temp files", () => {
    writeSnapshot(tmp, "2026-04-01-post-wave-1.json", { p95: 500, label: "post-wave-1" });
    writeFileSync(join(tmp, "README.md"), "not a snapshot");
    writeFileSync(join(tmp, "2026-04-01-adhoc.tmp.json"), "{}");
    const prior = findLatestPriorSnapshot(tmp, "post-wave-1");
    expect(prior?.p95).toBe(500);
  });

  it("returns null when the directory does not exist", () => {
    const prior = findLatestPriorSnapshot(join(tmp, "does-not-exist"), "x");
    expect(prior).toBeNull();
  });

  it("returns null when no snapshots match", () => {
    const prior = findLatestPriorSnapshot(tmp, "x");
    expect(prior).toBeNull();
  });
});

describe("detectRegression", () => {
  it("flags regression when current p95 exceeds prior p95 * (1 + threshold)", () => {
    // prior 500, current 600, threshold 0.15 → 500*1.15 = 575, 600 > 575
    const r = detectRegression({ priorP95: 500, currentP95: 600, threshold: 0.15 });
    expect(r.regressed).toBe(true);
    expect(r.budgetP95).toBeCloseTo(575);
    expect(r.deltaRatio).toBeCloseTo(0.2);
  });

  it("does NOT flag regression when current p95 is within budget", () => {
    // prior 500, current 570, threshold 0.15 → 575 budget, 570 < 575
    const r = detectRegression({ priorP95: 500, currentP95: 570, threshold: 0.15 });
    expect(r.regressed).toBe(false);
    expect(r.budgetP95).toBeCloseTo(575);
    expect(r.deltaRatio).toBeCloseTo(0.14);
  });

  it("treats equal-to-budget as NOT regressed (strictly greater-than)", () => {
    const r = detectRegression({ priorP95: 500, currentP95: 575, threshold: 0.15 });
    expect(r.regressed).toBe(false);
  });

  it("never flags regression when prior is null (first run)", () => {
    const r = detectRegression({ priorP95: null, currentP95: 9999, threshold: 0.15 });
    expect(r.regressed).toBe(false);
    expect(r.budgetP95).toBeNull();
  });
});

// ── cache-buster query param ──────────────────────────────────────────

describe("cache-buster", () => {
  it("appends ?__bust=<value> (unique per iteration) to the URL", async () => {
    const { buildCacheBustedUrl } = await import("../../scripts/bench-prod-cold");
    const u1 = buildCacheBustedUrl("https://example.com/path", 0);
    const u2 = buildCacheBustedUrl("https://example.com/path", 1);
    expect(u1).toMatch(/[?&]__bust=/);
    expect(u2).toMatch(/[?&]__bust=/);
    expect(u1).not.toBe(u2);
  });

  it("preserves existing query params by using & instead of ?", async () => {
    const { buildCacheBustedUrl } = await import("../../scripts/bench-prod-cold");
    const out = buildCacheBustedUrl("https://example.com/path?foo=bar", 0);
    expect(out).toMatch(/^https:\/\/example\.com\/path\?foo=bar&__bust=/);
  });
});
