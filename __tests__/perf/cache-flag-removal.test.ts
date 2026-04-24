/**
 * __tests__/perf/cache-flag-removal.test.ts
 *
 * Phase F contract: `FARM_CACHE_ENABLED_SLUGS` and the `isCacheEnabled()`
 * gate are deleted. The cache layer runs unconditionally for every tenant,
 * so:
 *
 *   - `lib/flags.ts` no longer exists as a module.
 *   - `app/[farmSlug]/dashboard/page.tsx`, `app/[farmSlug]/layout.tsx`,
 *     and `app/farms/page.tsx` import only cached helpers — no
 *     `isCacheEnabled` import, no `else` branch that hits raw Prisma
 *     inline.
 *
 * These assertions lock in the structural change so a future contributor
 * can't re-introduce the flag without the suite going red.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");

function read(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf8");
}

describe("Phase F — cache flag removed", () => {
  it("lib/flags.ts module has been deleted", () => {
    expect(existsSync(join(REPO_ROOT, "lib/flags.ts"))).toBe(false);
  });

  it("dashboard page has no isCacheEnabled import or gate", () => {
    const src = read("app/[farmSlug]/dashboard/page.tsx");
    expect(src).not.toMatch(/isCacheEnabled/);
    expect(src).not.toMatch(/@\/lib\/flags/);
    // Uncached fallback path invoked raw Prisma for the dashboard — that
    // inline 8-query Promise.all is gone now that the cached helper is
    // unconditional.
    expect(src).not.toMatch(/getPrismaForFarm/);
    expect(src).toMatch(/getCachedDashboardData/);
  });

  it("farm layout has no isCacheEnabled import or gate", () => {
    const src = read("app/[farmSlug]/layout.tsx");
    expect(src).not.toMatch(/isCacheEnabled/);
    expect(src).not.toMatch(/@\/lib\/flags/);
    expect(src).not.toMatch(/getPrismaForFarm/);
    expect(src).toMatch(/getCachedFarmSpeciesSettings/);
  });

  it("farms (multi-farm picker) page has no isCacheEnabled gate", () => {
    const src = read("app/farms/page.tsx");
    expect(src).not.toMatch(/isCacheEnabled/);
    expect(src).not.toMatch(/@\/lib\/flags/);
    // The uncached fallback was getOverviewForUserFarms; only the cached
    // helper should remain after Phase F.
    expect(src).not.toMatch(/getOverviewForUserFarms/);
    expect(src).toMatch(/getCachedMultiFarmOverview/);
  });
});
