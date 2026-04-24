// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Phase K: the admin overview must not do a direct, uncached
// `prisma.farmSettings` lookup — that call is outside any <Suspense>
// boundary and blocks first paint on a Tokyo RTT. It must delegate to
// getCachedFarmSettings() from lib/server/cached.ts (tagged-cache, 5 min).
//
// Guard string-level so that a well-intentioned future refactor can't
// silently reintroduce the uncached call.
describe("app/[farmSlug]/admin/page.tsx — Phase K cached settings", () => {
  const src = readFileSync(
    join(process.cwd(), "app", "[farmSlug]", "admin", "page.tsx"),
    "utf8",
  );

  it("does not call prisma.farmSettings directly", () => {
    // Block every Prisma accessor pattern that would hit the DB uncached.
    expect(src).not.toMatch(/prisma\.farmSettings\.findFirst/);
    expect(src).not.toMatch(/prisma\.farmSettings\.findUnique/);
    expect(src).not.toMatch(/prisma\.farmSettings\.findMany/);
    expect(src).not.toMatch(/prisma\.farmSettings\./);
  });

  it("imports getCachedFarmSettings from @/lib/server/cached", () => {
    expect(src).toMatch(
      /import\s+\{[^}]*\bgetCachedFarmSettings\b[^}]*\}\s+from\s+["']@\/lib\/server\/cached["']/,
    );
  });

  it("invokes getCachedFarmSettings with the farm slug", () => {
    expect(src).toMatch(/getCachedFarmSettings\(\s*farmSlug\s*\)/);
  });
});
