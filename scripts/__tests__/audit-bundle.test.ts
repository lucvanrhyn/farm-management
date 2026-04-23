import { describe, it, expect } from "vitest";
import {
  auditRoutes,
  DEFAULT_BUDGETS,
  extractScriptSrcs,
  type RouteBundle,
} from "../audit-bundle";

/**
 * The audit script walks Next's build manifest and sums the brotli-
 * compressed first-load transfer per route. If any route breaches its
 * budget the script exits non-zero so CI fails.
 *
 * These tests hit the pure core: given a fixture of per-route bundle
 * sizes, does `auditRoutes` flag breaches correctly? That keeps the
 * budget logic unit-testable without spinning up a real `next build`.
 */

describe("auditRoutes", () => {
  it("passes when every route is under its budget", () => {
    // Values comfortably below both budgets.
    const routes: RouteBundle[] = [
      { route: "/login", brotliBytes: 80_000, uncompressedBytes: 300_000 },
      { route: "/register", brotliBytes: 100_000, uncompressedBytes: 400_000 },
    ];
    const result = auditRoutes(routes, DEFAULT_BUDGETS);
    expect(result.pass).toBe(true);
    expect(result.breaches).toEqual([]);
  });

  it("fails when /login exceeds its brotli budget", () => {
    // Pick a size that is unambiguously over whatever the current
    // /login budget is. Tests the breach-reporting shape, not the
    // exact ceiling value (that's covered by the contract test
    // below).
    const routes: RouteBundle[] = [
      { route: "/login", brotliBytes: 999_999, uncompressedBytes: 9_999_999 },
    ];
    const result = auditRoutes(routes, DEFAULT_BUDGETS);
    expect(result.pass).toBe(false);
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]).toMatchObject({
      route: "/login",
      brotliBytes: 999_999,
      budgetBytes: DEFAULT_BUDGETS["/login"],
    });
  });

  it("fails when /register exceeds its brotli budget", () => {
    const routes: RouteBundle[] = [
      { route: "/register", brotliBytes: 999_999, uncompressedBytes: 9_999_999 },
    ];
    const result = auditRoutes(routes, DEFAULT_BUDGETS);
    expect(result.pass).toBe(false);
    expect(result.breaches[0].route).toBe("/register");
  });

  it("ignores routes that have no matching budget", () => {
    const routes: RouteBundle[] = [
      { route: "/[farmSlug]/admin", brotliBytes: 400_000, uncompressedBytes: 1_200_000 },
    ];
    const result = auditRoutes(routes, DEFAULT_BUDGETS);
    expect(result.pass).toBe(true);
  });

  it("budgets stay aggressive — /login ≤ 115 KB, /register ≤ 125 KB", () => {
    // The pre-P5 baseline was ~228 KB brotli on /login and ~215 KB
    // on /register. The budgets below represent a >45% reduction
    // and any attempt to loosen them further should be a deliberate
    // product decision — hence this assertion.
    expect(DEFAULT_BUDGETS["/login"]).toBeLessThanOrEqual(115_000);
    expect(DEFAULT_BUDGETS["/register"]).toBeLessThanOrEqual(125_000);
  });
});

describe("extractScriptSrcs", () => {
  it("returns module scripts and ignores noModule fallbacks", () => {
    // noModule scripts are only evaluated on legacy browsers and do
    // not ship to the Chrome 90+ / Safari 14+ targets we care about,
    // so they must not count against the first-load budget.
    const html = [
      '<script src="/_next/static/chunks/main.js"></script>',
      '<script src="/_next/static/chunks/polyfills.js" noModule=""></script>',
      '<script src="/_next/static/chunks/app/login/page.js"></script>',
    ].join("\n");
    const srcs = extractScriptSrcs(html);
    expect(srcs).toEqual([
      "/_next/static/chunks/main.js",
      "/_next/static/chunks/app/login/page.js",
    ]);
  });

  it("deduplicates scripts that appear more than once", () => {
    const html =
      '<script src="/_next/a.js"></script><script src="/_next/a.js"></script>';
    expect(extractScriptSrcs(html)).toEqual(["/_next/a.js"]);
  });
});
