/**
 * @vitest-environment node
 *
 * Wave A — route-handler architectural invariant.
 *
 * After Wave A, every migrated `app/api/**\/route.ts` must export its
 * handler from one of the named adapters in `lib/server/route/`:
 *   - `tenantRead` / `tenantReadSlug`   (Wave G1+)
 *   - `adminWrite` / `adminWriteSlug`   (Wave G1+)
 *   - `tenantWrite` / `tenantWriteSlug` (Wave G1+)
 *   - `publicHandler`
 *
 * That structural rule means "I forgot try/catch on this one route" is
 * impossible: the adapter owns the try/catch, the typed-error envelope,
 * the `getFarmContext` resolution, the role gate, the body parse, and
 * the revalidate hook. See `docs/adr/0001-route-handler-architecture.md`.
 *
 * This test mirrors `__tests__/api/session-consolidation-coverage.test.ts`
 * — same allowlist style, same shape, same string-level scan. It walks
 * `app/api/**\/route.ts` and fails if any non-EXEMPT file's
 * `export const (GET|POST|PATCH|PUT|DELETE)` declaration is not a call
 * expression on one of the four adapter names.
 *
 * The `EXEMPT` set seeds with every route that this wave does not yet
 * migrate. Each subsequent wave (B, C, D, ...) shrinks the set by
 * removing migrated entries. When Wave G lands, only the original
 * proxy-matcher exclusions (webhooks, telemetry beacon, auth catch-all)
 * remain — and those will be wrapped in `publicHandler`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const API_ROOT = join(REPO_ROOT, "app", "api");

/** Routes still on hand-rolled handler shape; one entry per route file. */
const EXEMPT: ReadonlySet<string> = new Set([
  // ── proxy-matcher exclusions: outside the auth hop, will be wrapped in
  //    `publicHandler` once the adapter contract has soaked. ──
  "auth/[...nextauth]/route.ts",
  "auth/login-check/route.ts",
  "auth/register/route.ts",
  "auth/resend-verification/route.ts",
  "auth/verify-email/route.ts",
  "csp-report/route.ts",
  "einstein/ask/route.ts",
  "einstein/feedback/route.ts",
  "farms/[slug]/select/route.ts",
  "health/route.ts",
  "inngest/route.ts",
  "telemetry/client-errors/route.ts",
  "telemetry/vitals/route.ts",
  "webhooks/payfast/route.ts",

  // ── platform-admin / cross-farm: not under per-farm context. ──
  "admin/consulting/[id]/route.ts",
  "admin/evict-farm-client/route.ts",
  "admin/reset/route.ts",
  "subscription/status/route.ts",

  // ── Wave B+ migration — see ADR-0001. ──
  // [farmSlug]/** routes (Wave B-G).
  "[farmSlug]/breeding/analyze/route.ts",
  "[farmSlug]/budgets/route.ts",
  "[farmSlug]/camps/[campId]/cover/[readingId]/attachment/route.ts",
  "[farmSlug]/camps/[campId]/cover/route.ts",
  "[farmSlug]/camps/[campId]/stats/route.ts",
  "[farmSlug]/export/route.ts",
  "[farmSlug]/farm-settings/ai/route.ts",
  "[farmSlug]/farm-settings/methodology/route.ts",
  "[farmSlug]/feed-on-offer/route.ts",
  "[farmSlug]/financial-analytics/route.ts",
  // Wave G1 (#165) — NVD slice (5 routes) migrated onto slug-aware adapters.
  // Wave G2 (#166) — rotation slice (5 routes) migrated onto slug-aware adapters.
  // Wave G3 (#167) — map slice (4 routes) migrated onto slug-aware adapters.
  "[farmSlug]/performance/route.ts",
  "[farmSlug]/profitability-by-animal/route.ts",
  "[farmSlug]/rainfall/route.ts",
  "[farmSlug]/settings/alerts/route.ts",
  "[farmSlug]/tax/it3/[id]/pdf/route.ts",
  "[farmSlug]/tax/it3/[id]/route.ts",
  "[farmSlug]/tax/it3/[id]/void/route.ts",
  "[farmSlug]/tax/it3/preview/route.ts",
  "[farmSlug]/tax/it3/route.ts",
  "[farmSlug]/transactions/route.ts",
  "[farmSlug]/veld-assessments/[id]/route.ts",
  "[farmSlug]/veld-assessments/route.ts",
  "[farmSlug]/veld-score/summary/route.ts",

  // Other shared routes — Wave B+ migration in dependency order.
  "farm-settings/map/route.ts",
  "farm-settings/tasks/route.ts",
  "farm/route.ts",
  "farm/settings/route.ts",
  "farm/species-settings/route.ts",
  "map/gis/afis/route.ts",
  "map/gis/eskom-se-push/allowances/route.ts",
  "map/gis/eskom-se-push/status/[areaId]/route.ts",
  "map/gis/fmd-zones/route.ts",
  "map/gis/saws-fdi/route.ts",
  "onboarding/commit-import/route.ts",
  "onboarding/map-columns/route.ts",
  "onboarding/template/route.ts",
  "sheets/route.ts",
  "task-occurrences/route.ts",
  "task-templates/[id]/route.ts",
  "task-templates/install/route.ts",
  "transaction-categories/[id]/route.ts",
  "transaction-categories/route.ts",
]);

const ADAPTER_NAMES = [
  "tenantRead",
  "adminWrite",
  "tenantWrite",
  "publicHandler",
  // Wave G1 (#165) — slug-aware variants for `[farmSlug]/**` routes.
  "tenantReadSlug",
  "adminWriteSlug",
  "tenantWriteSlug",
] as const;
const HANDLER_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Check that every `export const <METHOD> = <expr>` declaration in the
 * file is wired to one of the adapter names. Returns the list of
 * violating method names (empty when the file is fully wired).
 *
 * The match is intentionally lenient on whitespace/newlines and accepts
 * a generic-arg form (`adminWrite<Body>(...)`).
 */
function adapterViolations(source: string): string[] {
  const adapterAlt = ADAPTER_NAMES.join("|");
  const violations: string[] = [];
  for (const method of HANDLER_METHODS) {
    // Match `export const GET = ` followed by content up to the line end /
    // call expression. We accept both `adminWrite(` and `adminWrite<...>(`
    // and tolerate inline whitespace.
    const declRe = new RegExp(
      `export\\s+const\\s+${method}\\s*(?::[^=]+)?=\\s*([\\s\\S]+?)\\(`,
      "g",
    );
    const match = declRe.exec(source);
    if (!match) {
      // Also tolerate `export async function GET(...)` form when the body
      // immediately delegates to an adapter — but the adapter contract is
      // expressed at the export site by design, so we treat this as a
      // violation: the wave plan's invariant is that the export expression
      // IS the adapter call.
      const fnRe = new RegExp(
        `export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`,
      );
      if (fnRe.test(source)) violations.push(method);
      continue;
    }
    // `match[1]` is everything between `=` and the opening `(`. Strip
    // generic args and whitespace to get the callee identifier.
    const callee = match[1].replace(/<[\s\S]*>$/, "").trim();
    if (!new RegExp(`^(?:${adapterAlt})$`).test(callee)) {
      violations.push(method);
    }
  }
  return violations;
}

describe("route-handler architectural coverage", () => {
  const files = walk(API_ROOT).sort();

  it("discovered at least the routes we expect (sanity floor)", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("every non-exempt API route exports handlers via the four adapters", () => {
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = relative(API_ROOT, abs);
      if (EXEMPT.has(rel)) continue;
      const src = readFileSync(abs, "utf8");
      const v = adapterViolations(src);
      if (v.length > 0) offenders.push(`${rel}: [${v.join(", ")}]`);
    }
    expect(
      offenders,
      [
        "Routes still on hand-rolled handler shape:",
        ...offenders,
        "",
        "Wrap each export with one of:",
        "  tenantRead | tenantReadSlug | adminWrite | adminWriteSlug | tenantWrite | tenantWriteSlug | publicHandler",
        "from `@/lib/server/route` per ADR-0001.",
        "",
        "If the route is intentionally outside the four-adapter contract, add",
        "it to the EXEMPT set in this test with a comment explaining why.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("every exempt file still exists (allowlist cannot rot)", () => {
    const discovered = new Set(files.map((f) => relative(API_ROOT, f)));
    const missing: string[] = [];
    for (const rel of EXEMPT) {
      if (!discovered.has(rel)) missing.push(rel);
    }
    expect(
      missing,
      `Exempt routes no longer exist — prune the list:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
