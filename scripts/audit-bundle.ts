#!/usr/bin/env tsx
/**
 * Post-build bundle audit.
 *
 * For each budgeted route, inspect Next.js's prerendered HTML under
 * `.next/server/app/<route>.html`, extract every <script src="...">,
 * brotli-compress each chunk and sum. If a route exceeds its budget
 * the script exits non-zero so CI fails.
 *
 * Using the prerendered HTML as the source of truth is more robust
 * than reading per-route manifests (which moved around in Next 16):
 * the HTML is literally what the browser fetches on a cold visit.
 *
 * The core logic (auditRoutes) is a pure function — exported so
 * scripts/__tests__/audit-bundle.test.ts can drive it with fixtures
 * without running a real `next build`.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// ─── Public types ──────────────────────────────────────────────────────────

export interface RouteBundle {
  route: string; // e.g. "/login" or "/register"
  brotliBytes: number; // sum of first-load JS, brotli-compressed
  uncompressedBytes: number; // sum of first-load JS, raw
  scriptCount?: number; // informational; how many <script src> the HTML lists
}

export interface BudgetBreach {
  route: string;
  brotliBytes: number;
  budgetBytes: number;
}

export interface AuditResult {
  pass: boolean;
  breaches: BudgetBreach[];
  inspected: RouteBundle[];
}

// Budgets expressed in bytes.
//
// /login is the cold-entry path for every new visitor so it gets the
// tightest budget. The practical floor is dominated by the React 19
// runtime (~55 KB brotli) + the Next 16 app-router runtime (~45 KB
// brotli) — together ~100 KB of framework before a single line of
// our code runs. We hold the line at 115 KB: that's comfortably
// below the pre-P5 baseline of ~228 KB brotli and leaves ~8 KB of
// headroom for small regressions before CI trips.
//
// /register ships a larger form (6 labelled inputs + a success screen)
// and uses a reference to `signIn` only via a hard-link to /login, so
// it stays slightly smaller in practice; we give it 125 KB to match
// the same headroom profile as /login.
export const DEFAULT_BUDGETS: Record<string, number> = {
  "/login": 115_000,
  "/register": 125_000,
};

// ─── Pure core ─────────────────────────────────────────────────────────────

export function auditRoutes(
  routes: RouteBundle[],
  budgets: Record<string, number> = DEFAULT_BUDGETS,
): AuditResult {
  const breaches: BudgetBreach[] = [];
  const inspected: RouteBundle[] = [];
  for (const bundle of routes) {
    const budget = budgets[bundle.route];
    if (budget === undefined) continue; // unbudgeted routes are ignored
    inspected.push(bundle);
    if (bundle.brotliBytes > budget) {
      breaches.push({
        route: bundle.route,
        brotliBytes: bundle.brotliBytes,
        budgetBytes: budget,
      });
    }
  }
  return { pass: breaches.length === 0, breaches, inspected };
}

// ─── HTML + chunk measurement ──────────────────────────────────────────────

/**
 * Pull each <script src="..."> JS file out of the HTML, excluding any
 * tag that carries the `noModule` attribute. Modern browsers don't
 * download-or-execute `noModule` scripts — they're a legacy fallback
 * for ES5-only engines that we've already dropped via browserslist.
 * Counting them against the budget would penalise the transfer we
 * actually care about (the first-load JS on a current iPhone/Android).
 */
export function extractScriptSrcs(html: string): string[] {
  const re = /<script\b([^>]*)\bsrc="([^"]+\.js[^"]*)"([^>]*)>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrsBefore = m[1];
    const attrsAfter = m[3];
    const combined = `${attrsBefore} ${attrsAfter}`;
    if (/\bnoModule\b|\bnomodule\b/.test(combined)) continue;
    out.push(m[2]);
  }
  return Array.from(new Set(out));
}

function measureFile(filePath: string): { brotli: number; raw: number } {
  const buf = readFileSync(filePath);
  const brotli = zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    },
  });
  return { brotli: brotli.length, raw: buf.length };
}

/**
 * Resolve a `/_next/static/...` src from the HTML to an absolute path
 * inside the `.next` build directory. Returns null when the file is
 * served dynamically (e.g. a route-handler or a blob we don't ship).
 */
function resolveChunk(nextDir: string, src: string): string | null {
  if (!src.startsWith("/_next/")) return null;
  // "/_next/static/..." → ".next/static/..."
  const rel = src.replace(/^\/_next\//, "");
  const abs = path.join(nextDir, rel);
  return existsSync(abs) ? abs : null;
}

/**
 * Measure every budgeted route in the current `.next` build by
 * reading its prerendered HTML and summing the scripts it loads.
 */
export function collectRouteBundles(
  nextDir: string = path.join(process.cwd(), ".next"),
  budgets: Record<string, number> = DEFAULT_BUDGETS,
): RouteBundle[] {
  const bundles: RouteBundle[] = [];
  for (const route of Object.keys(budgets)) {
    const htmlName = route === "/" ? "index" : route.replace(/^\//, "");
    const htmlPath = path.join(nextDir, "server", "app", `${htmlName}.html`);
    if (!existsSync(htmlPath)) {
      throw new Error(
        `Prerendered HTML not found at ${htmlPath}. Route '${route}' may not be statically generated — check \`next build\` output.`,
      );
    }
    const html = readFileSync(htmlPath, "utf8");
    const srcs = extractScriptSrcs(html);
    let brotli = 0;
    let raw = 0;
    for (const src of srcs) {
      const abs = resolveChunk(nextDir, src);
      if (!abs) continue;
      const m = measureFile(abs);
      brotli += m.brotli;
      raw += m.raw;
    }
    bundles.push({
      route,
      brotliBytes: brotli,
      uncompressedBytes: raw,
      scriptCount: srcs.length,
    });
  }
  return bundles;
}

// ─── CLI entry-point ───────────────────────────────────────────────────────

function formatBytes(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

function main(): void {
  const nextDir = path.join(process.cwd(), ".next");
  const bundles = collectRouteBundles(nextDir);
  const result = auditRoutes(bundles);

  console.log("Bundle audit — first-load JS by route");
  console.log("=".repeat(72));
  for (const b of result.inspected) {
    const budget = DEFAULT_BUDGETS[b.route];
    const pass = b.brotliBytes <= budget;
    const marker = pass ? "PASS" : "FAIL";
    console.log(
      `${marker}  ${b.route.padEnd(14)} brotli=${formatBytes(b.brotliBytes).padStart(9)}  raw=${formatBytes(b.uncompressedBytes).padStart(9)}  scripts=${String(b.scriptCount ?? 0).padStart(2)}  budget=${formatBytes(budget)}`,
    );
  }
  console.log("=".repeat(72));

  if (!result.pass) {
    console.error("\nBudget breaches:");
    for (const br of result.breaches) {
      console.error(
        `  ${br.route}: ${formatBytes(br.brotliBytes)} exceeds ${formatBytes(br.budgetBytes)}`,
      );
    }
    process.exit(1);
  }
  console.log("All routes within budget.");
}

// Only run as CLI when invoked directly — allow tests to import the
// module without triggering main(). Vitest never puts our script at
// argv[1], so a simple filename check is enough and works across
// Node's file:// quirks on macOS.
const isCliEntry = (() => {
  const entry = process.argv[1];
  return typeof entry === "string" && entry.endsWith("audit-bundle.ts");
})();
if (isCliEntry) main();
