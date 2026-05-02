/**
 * @vitest-environment node
 *
 * __tests__/api/proxy-matcher.test.ts — Phase K Wave 3G
 *
 * Rationale: Phase J memory "Proxy matcher blind spot" — new /api/* routes
 * silently 307 to /login when the Next.js middleware matcher excludes them.
 * This test parses the ACTUAL config.matcher[0] string from middleware.ts at test
 * time (via fs), converts it to a regexp, and asserts each Phase K route has
 * the expected auth disposition so regressions are caught at CI rather than
 * after preview deploy.
 *
 * Rules:
 *   requiresAuth: true  → path MUST match the regex (proxy runs → JWT checked)
 *   requiresAuth: false → path MUST NOT match (proxy skips → unauthenticated OK)
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Read middleware.ts config.matcher at test time ─────────────────────────────────
// We extract the raw string from the source so any edits to proxy.ts are
// automatically picked up without updating this file.

let matcherRegex: RegExp;

beforeAll(() => {
  const proxyPath = path.resolve(__dirname, "../../proxy.ts");
  const src = fs.readFileSync(proxyPath, "utf8");

  // Extract the first string inside config.matcher: ["..."]
  // The pattern ends at the closing quote before the comma/bracket.
  const match = src.match(/matcher\s*:\s*\[\s*["']([^"']+)["']/);
  if (!match) {
    throw new Error(
      "Could not extract config.matcher[0] from proxy.ts — regex parse failed",
    );
  }

  const rawPattern = match[1];

  // proxy.ts stores the matcher string as a TypeScript string literal with \\. to
  // denote a literal dot in the regex (e.g. `sw\\.js`). After fs.readFileSync the
  // string contains `sw\\.js` (one backslash + period) which, when used as a JS
  // RegExp pattern, is correct: `\\.` in a source string → `\.` in regex.
  //
  // However, the *actual* bytes in the file are `sw\\\\.js` (two backslashes) so
  // that the TypeScript compiler emits `sw\\.js` at runtime. When fs.readFileSync
  // reads the raw source it sees `\\\\` which becomes `\\` in the JS string —
  // a literal two-char sequence (backslash + backslash) that the RegExp constructor
  // interprets as an escaped backslash (not an escaped dot). We must normalise by
  // collapsing each `\\` → `\` so the regex treats `.` as literal.
  const pattern = rawPattern.replace(/\\\\/g, "\\");

  // Convert the Next.js matcher string to a full JS regex.
  // Next.js tests matcher against the full pathname, so we anchor it: ^pattern$
  const regexStr = "^" + pattern + "$";
  matcherRegex = new RegExp(regexStr);
});

// ── Helper ─────────────────────────────────────────────────────────────────────
function matchesProxy(pathname: string): boolean {
  return matcherRegex.test(pathname);
}

// ── Phase K routes under test ─────────────────────────────────────────────────
// requiresAuth: true  → proxy must run (JWT validated) — path must match regex
// requiresAuth: false → proxy must NOT run — path must not match regex

const PHASE_K_ROUTES: Array<{
  label: string;
  path: string;
  requiresAuth: boolean;
}> = [
  // Task management endpoints
  {
    label: "task-templates install",
    path: "/api/task-templates/install",
    requiresAuth: true,
  },
  {
    label: "task-occurrences list",
    path: "/api/task-occurrences",
    requiresAuth: true,
  },
  {
    label: "task-templates by cuid (concrete ID)",
    path: "/api/task-templates/cm9abc123",
    requiresAuth: true,
  },
  {
    label: "farm settings tasks sub-path",
    path: "/api/farm/settings/tasks",
    requiresAuth: true,
  },

  // Tenant map endpoints (concrete slugs)
  {
    label: "water-points — trio-b-boerdery",
    path: "/api/trio-b-boerdery/map/water-points",
    requiresAuth: true,
  },
  {
    label: "infrastructure — trio-b-boerdery",
    path: "/api/trio-b-boerdery/map/infrastructure",
    requiresAuth: true,
  },
  {
    label: "rainfall-gauges — trio-b-boerdery",
    path: "/api/trio-b-boerdery/map/rainfall-gauges",
    requiresAuth: true,
  },
  {
    label: "task-pins — trio-b-boerdery",
    path: "/api/trio-b-boerdery/map/task-pins",
    requiresAuth: true,
  },
  // Second tenant variant
  {
    label: "water-points — basson-boerdery",
    path: "/api/basson-boerdery/map/water-points",
    requiresAuth: true,
  },

  // GIS proxy routes
  {
    label: "AFIS fire-perimeters proxy",
    path: "/api/map/gis/afis",
    requiresAuth: true,
  },
  {
    label: "SAWS FDI proxy",
    path: "/api/map/gis/saws-fdi",
    requiresAuth: true,
  },
  {
    label: "Eskom EskomSePush allowances",
    path: "/api/map/gis/eskom-se-push/allowances",
    requiresAuth: true,
  },
  {
    label: "Eskom EskomSePush status with concrete areaId",
    path: "/api/map/gis/eskom-se-push/status/eskde-10-witbankmp",
    requiresAuth: true,
  },
  {
    label: "FMD zones static GeoJSON",
    path: "/api/map/gis/fmd-zones",
    requiresAuth: true,
  },
];

// ── Routes that MUST be excluded from proxy (regression guard) ─────────────────
// These already existed in Phase J; verifying they still pass through unguarded.
const KNOWN_PUBLIC_ROUTES: Array<{ label: string; path: string }> = [
  { label: "NextAuth signin handler", path: "/api/auth/signin" },
  { label: "NextAuth CSRF", path: "/api/auth/csrf" },
  { label: "NextAuth callback", path: "/api/auth/callback/credentials" },
  { label: "Inngest webhook (Phase J hotfix)", path: "/api/inngest" },
  { label: "Einstein ask (Phase L Wave 2B)", path: "/api/einstein/ask" },
  { label: "Einstein feedback (Phase L Wave 2B)", path: "/api/einstein/feedback" },
  { label: "Observations logger (public write)", path: "/api/observations" },
  { label: "PayFast webhook", path: "/api/webhooks/payfast" },
  { label: "Login page", path: "/login" },
  { label: "Register page", path: "/register" },
  { label: "Verify-email page", path: "/verify-email" },
  { label: "Subscribe page", path: "/subscribe" },
  { label: "Offline shell", path: "/offline" },
  { label: "SW static asset", path: "/sw.js" },
  { label: "PNG asset", path: "/icons/logo.png" },
  { label: "JPG asset", path: "/og-image.jpg" },
  // Phase C bug C1: uptime probe must be reachable unauthenticated.
  { label: "Health probe (Phase C)", path: "/api/health" },
  // Phase C bug C3: /demo is documented as a public marketing surface.
  // Allow-listed in middleware so the page (when present) is reachable
  // unauthenticated. If the page does not exist Next will render the
  // app/not-found.tsx fallthrough — see Phase C bug C2.
  { label: "Demo landing (Phase C)", path: "/demo" },
  { label: "Demo nested (Phase C)", path: "/demo/vision" },
  // Wave 4 A8: CSP violation reports are POSTed by browsers without
  // cookies — gating would drop every report and leave the report-only
  // soak telemetry empty.
  { label: "CSP report sink (Wave 4 A8)", path: "/api/csp-report" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Assertions
// ─────────────────────────────────────────────────────────────────────────────

describe("middleware.ts config.matcher — Phase K route auth disposition", () => {
  it("parses a valid regex from proxy.ts", () => {
    expect(matcherRegex).toBeInstanceOf(RegExp);
    // Sanity: the regex should at minimum match some paths
    expect(matcherRegex.test("/api/camps")).toBe(true);
  });

  for (const route of PHASE_K_ROUTES) {
    it(`[AUTH] ${route.label} — proxy runs on ${route.path}`, () => {
      const matches = matchesProxy(route.path);
      if (route.requiresAuth) {
        expect(matches).toBe(true);
      } else {
        expect(matches).toBe(false);
      }
    });
  }
});

describe("middleware.ts config.matcher — known public routes must NOT trigger proxy", () => {
  for (const route of KNOWN_PUBLIC_ROUTES) {
    it(`[PUBLIC] ${route.label} — proxy skips ${route.path}`, () => {
      expect(matchesProxy(route.path)).toBe(false);
    });
  }
});

// ── Phase C bug C2: isProtectedPath fall-through ──────────────────────────────
//
// The matcher controls which paths the proxy *runs* on. For paths that DO
// reach the proxy without a token, the proxy must only redirect to /login
// when the path is actually a protected one — otherwise it must fall through
// to Next so app/not-found.tsx renders for typos. This block locks the
// disposition of `isProtectedPath()` in.

describe("proxy.ts isProtectedPath — Phase C bug C2 fall-through", () => {
  it.each([
    ["/", "anon root → login (preserved behaviour)"],
    ["/farms", "farm hub"],
    ["/farms/new", "farm hub sub-route"],
    ["/home", "universal entry point"],
    ["/home/dashboard", "home sub-route"],
    ["/trio-b-boerdery/admin/animals", "tenant admin"],
    ["/trio-b-boerdery/dashboard", "tenant dashboard"],
    ["/trio-b-boerdery/logger", "tenant logger"],
    ["/basson-boerdery/sheep", "tenant sheep"],
    ["/api/camps", "authenticated API"],
    ["/api/farm/settings/tasks", "deep authenticated API"],
  ])("[PROTECTED] %s — %s", async (path) => {
    const { isProtectedPath } = await import("../../proxy");
    expect(isProtectedPath(path)).toBe(true);
  });

  it.each([
    ["/some-nonexistent-path-12345", "random typo"],
    ["/farmz", "near-miss for /farms"],
    ["/about", "marketing page that does not exist"],
    ["/pricing", "marketing page that does not exist"],
    ["/.well-known/security.txt", "well-known probe"],
    ["/robots-extra.txt", "asset-shaped path"],
  ])("[FALL-THROUGH] %s — %s", async (path) => {
    const { isProtectedPath } = await import("../../proxy");
    expect(isProtectedPath(path)).toBe(false);
  });
});

describe("middleware.ts config.matcher — edge cases", () => {
  it("matches arbitrary authenticated pages", () => {
    expect(matchesProxy("/trio-b-boerdery/admin/tasks")).toBe(true);
    expect(matchesProxy("/farms")).toBe(true);
    expect(matchesProxy("/")).toBe(true);
  });

  it("does not match paths that include api/auth as substring elsewhere", () => {
    // /api/auth must be excluded but /api/auth-custom (hypothetical) should be checked carefully
    // The negative-lookahead anchors on the start of the remainder after leading /
    expect(matchesProxy("/api/auth/session")).toBe(false);
  });

  it("does not match _next static assets", () => {
    expect(matchesProxy("/_next/static/chunks/main.js")).toBe(false);
    expect(matchesProxy("/_next/image?url=...")).toBe(false);
  });

  it("correctly handles Eskom status with various area ID formats", () => {
    // Any area ID that is alphanumeric with hyphens should be guarded
    expect(matchesProxy("/api/map/gis/eskom-se-push/status/eskde-10-witbankmp")).toBe(true);
    expect(matchesProxy("/api/map/gis/eskom-se-push/status/eskde-7-soweto")).toBe(true);
  });

  it("guards all tenant slugs — not just trio-b-boerdery", () => {
    const slugs = ["trio-b-boerdery", "basson-boerdery", "my-farm-2026", "test-tenant"];
    for (const slug of slugs) {
      expect(matchesProxy(`/api/${slug}/map/water-points`)).toBe(true);
      expect(matchesProxy(`/api/${slug}/map/task-pins`)).toBe(true);
    }
  });
});
