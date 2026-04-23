/**
 * scripts/bench-snapshot.ts — extracts headline numbers from the
 * `.lighthouseci/manifest.json` produced by `lhci autorun` and writes
 * two JSON files:
 *   - tasks/bench/latest.json                (always overwritten)
 *   - tasks/bench/<iso-timestamp>.json       (new per-run)
 *
 * The snapshot contains one entry per URL in the LHCI run with FCP,
 * LCP, TTI, total JS transfer, and the Lighthouse performance score.
 * This is the raw material for week-over-week perf diffs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBenchSnapshot, parseLhciManifest } from "../bench-snapshot";

// ── Fixtures ────────────────────────────────────────────────────────────

const SAMPLE_MANIFEST = [
  {
    url: "http://localhost:3001/login",
    isRepresentativeRun: true,
    jsonPath: "sample-0.json",
    summary: {
      performance: 0.92,
      "first-contentful-paint": 1234,
      "largest-contentful-paint": 1800,
      interactive: 2500,
    },
  },
  {
    url: "http://localhost:3001/delta-livestock/home",
    isRepresentativeRun: true,
    jsonPath: "sample-1.json",
    summary: {
      performance: 0.85,
      "first-contentful-paint": 1500,
      "largest-contentful-paint": 2100,
      interactive: 3100,
    },
  },
  {
    // Non-representative runs should be ignored.
    url: "http://localhost:3001/login",
    isRepresentativeRun: false,
    jsonPath: "sample-0b.json",
    summary: { performance: 0.5, "first-contentful-paint": 9999 },
  },
];

const SAMPLE_RESOURCE_SUMMARY = [
  { resourceType: "script", transferSize: 250_000 },
  { resourceType: "font", transferSize: 30_000 },
  { resourceType: "total", transferSize: 400_000 },
];

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "bench-snapshot-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ── parseLhciManifest ────────────────────────────────────────────────────

describe("parseLhciManifest", () => {
  it("extracts one entry per representative URL with the expected schema", () => {
    const lhciDir = join(tmp, ".lighthouseci");
    mkdirSync(lhciDir, { recursive: true });
    writeFileSync(join(lhciDir, "manifest.json"), JSON.stringify(SAMPLE_MANIFEST));

    // sample-0.json must contain a `resource-summary` audit for total-JS.
    writeFileSync(
      join(lhciDir, "sample-0.json"),
      JSON.stringify({
        audits: {
          "resource-summary": { details: { items: SAMPLE_RESOURCE_SUMMARY } },
        },
      }),
    );
    writeFileSync(
      join(lhciDir, "sample-1.json"),
      JSON.stringify({
        audits: {
          "resource-summary": { details: { items: SAMPLE_RESOURCE_SUMMARY } },
        },
      }),
    );

    const rows = parseLhciManifest(lhciDir);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      url: "http://localhost:3001/login",
      performance: 0.92,
      fcp: 1234,
      lcp: 1800,
      tti: 2500,
      jsTransferBytes: 250_000,
    });
    expect(rows[1].url).toContain("/home");
  });

  it("returns an empty array when the manifest does not exist", () => {
    // No manifest.json written to tmp — parser must not throw.
    expect(() => parseLhciManifest(tmp)).not.toThrow();
    expect(parseLhciManifest(tmp)).toEqual([]);
  });
});

// ── writeBenchSnapshot ───────────────────────────────────────────────────

describe("writeBenchSnapshot", () => {
  const rows = [
    {
      url: "http://localhost:3001/login",
      performance: 0.92,
      fcp: 1234,
      lcp: 1800,
      tti: 2500,
      jsTransferBytes: 250_000,
    },
  ];

  it("writes latest.json with schema: { generatedAt, runs }", () => {
    writeBenchSnapshot(tmp, rows);
    const latest = JSON.parse(readFileSync(join(tmp, "latest.json"), "utf-8"));
    expect(latest).toHaveProperty("generatedAt");
    expect(latest.runs).toEqual(rows);
    expect(new Date(latest.generatedAt).toString()).not.toBe("Invalid Date");
  });

  it("writes a timestamped file alongside latest.json", () => {
    writeBenchSnapshot(tmp, rows);
    const files = readdirSync(tmp);
    expect(files).toContain("latest.json");
    const timestamped = files.find((f) => f !== "latest.json");
    expect(timestamped).toBeTruthy();
    // ISO-ish name: YYYY-MM-DDTHH-MM-SS (colons replaced to be filesystem safe)
    expect(timestamped).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.*\.json$/);
  });

  it("overwrites latest.json but preserves previous timestamped files", async () => {
    writeBenchSnapshot(tmp, rows);
    // Wait a tick so the two timestamps differ.
    await new Promise((r) => setTimeout(r, 1100));
    writeBenchSnapshot(tmp, [{ ...rows[0], fcp: 999 }]);

    const files = readdirSync(tmp);
    // Two timestamped files + latest.json.
    expect(files.length).toBeGreaterThanOrEqual(3);
    const latest = JSON.parse(readFileSync(join(tmp, "latest.json"), "utf-8"));
    expect(latest.runs[0].fcp).toBe(999);
  });

  it("creates the output directory if it does not exist", () => {
    const nested = join(tmp, "deep", "path");
    expect(existsSync(nested)).toBe(false);
    writeBenchSnapshot(nested, rows);
    expect(existsSync(join(nested, "latest.json"))).toBe(true);
  });
});
