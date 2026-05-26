/**
 * lib/server/__tests__/cached-multi-farm-overview.test.ts
 *
 * Issue #423 — /farms selector cache coherence with the dashboard tier.
 *
 * The /farms page selector ("X animals · Y ago" cards) lagged the Admin
 * Overview by hours despite a 60s `unstable_cache` TTL, because its tag
 * set (animals + camps + observations) did not reliably receive the
 * invalidation events that the dashboard tier (`farm-<slug>-dashboard`)
 * already receives from every observation / animal / camp / transaction /
 * alert / rotation write surface (see PRD #412, shipped 2026-05-26).
 *
 * Fix: add `farmTag(slug, "dashboard")` to the selector's cache-tag
 * array, per farm in the user's session. The selector now rides the
 * dashboard tier and inherits its coherence; future write surfaces that
 * already bust `dashboard` automatically bust the selector too.
 *
 * Two contracts asserted:
 *   1. The selector's tag set for a multi-farm session includes a
 *      per-farm `farm-<slug>-dashboard` tag — proves the fix is in place.
 *   2. An observation write (via `revalidateObservationWrite`, which
 *      delegates to `observationWriteTags`) hits at least one tag in the
 *      selector's tag set — proves the wiring closes the coherence loop.
 *
 * Plus a regression check: the legacy animals/camps/observations tags
 * remain in the selector's tag set so any future write surface that busts
 * only one of those still busts the selector.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── unstable_cache stub: capture (tags, args) per call so we can assert
// on what the selector emits. We don't need TTL semantics for these tests
// (the bug is invalidation, not staleness within TTL).
const capturedTags: string[][] = [];

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => Promise<unknown>,
    _keyParts: string[],
    opts?: { tags?: readonly string[]; revalidate?: number },
  ) => {
    return async (...args: unknown[]) => {
      if (opts?.tags) capturedTags.push([...opts.tags]);
      return fn(...args);
    };
  },
  revalidateTag: vi.fn(),
}));

// ── multi-farm-overview mock: the selector delegates the fan-out to
// `getOverviewForUserFarms`. We stub it to a deterministic empty result
// so the assertions focus purely on cache-tag emission.
vi.mock("@/lib/server/multi-farm-overview", () => ({
  getOverviewForUserFarms: vi.fn(async () => []),
}));

import { getCachedMultiFarmOverview } from "@/lib/server/cached";
import { farmTag, observationWriteTags } from "@/lib/server/cache-tags";
import { revalidateTag } from "next/cache";
import type { SessionFarm } from "@/types/next-auth";

const sessionFarm = (slug: string): SessionFarm => ({
  slug,
  displayName: slug,
  role: "owner",
  logoUrl: null,
  tier: "Basic",
  subscriptionStatus: "active",
});

beforeEach(() => {
  capturedTags.length = 0;
  vi.mocked(revalidateTag).mockReset();
});

describe("getCachedMultiFarmOverview() cache tags (issue #423)", () => {
  it("tags the selector entry with farm-<slug>-dashboard for every farm in the session", async () => {
    await getCachedMultiFarmOverview("user-1", [
      sessionFarm("basson"),
      sessionFarm("trio-b"),
    ]);

    const allTags = capturedTags.flat();
    expect(allTags).toContain(farmTag("basson", "dashboard"));
    expect(allTags).toContain(farmTag("trio-b", "dashboard"));
  });

  it("regression: keeps animals + camps + observations tags so legacy write surfaces still bust the selector", async () => {
    await getCachedMultiFarmOverview("user-1", [
      sessionFarm("basson"),
      sessionFarm("trio-b"),
    ]);

    const allTags = capturedTags.flat();
    for (const slug of ["basson", "trio-b"]) {
      expect(allTags).toContain(farmTag(slug, "animals"));
      expect(allTags).toContain(farmTag(slug, "camps"));
      expect(allTags).toContain(farmTag(slug, "observations"));
    }
  });

  it("an observation write fires revalidateTag against at least one tag in the selector's tag set", async () => {
    // Capture the selector's tag set.
    await getCachedMultiFarmOverview("user-1", [sessionFarm("basson")]);
    const selectorTags = new Set(capturedTags.flat());

    // Simulate the observation-write side: invoke the same helper the
    // POST /api/observations route uses (`observationWriteTags`) and
    // route each emitted tag through `revalidateTag`. This mirrors
    // `revalidateObservationWrite` exactly without coupling to its
    // internal "max" profile argument.
    const writeTags = observationWriteTags("basson", "weight_record");
    for (const tag of writeTags) {
      (revalidateTag as unknown as (t: string) => void)(tag);
    }

    // The dashboard tag is in BOTH sets — that intersection is the fix.
    const revalidateCalls = vi
      .mocked(revalidateTag)
      .mock.calls.map((c) => c[0] as string);
    const intersection = revalidateCalls.filter((t) => selectorTags.has(t));
    expect(intersection.length).toBeGreaterThan(0);
    expect(intersection).toContain(farmTag("basson", "dashboard"));
  });

  it("a non-camp-inspection observation write (negative control still hits selector via dashboard tag)", async () => {
    // `weight_record` is NOT a camp inspection, so observationWriteTags
    // emits only [observations, dashboard]. Pre-fix, the selector had
    // neither of those reliably (the lag was hours). Post-fix, the
    // shared `dashboard` tag guarantees a hit.
    await getCachedMultiFarmOverview("user-1", [sessionFarm("basson")]);
    const selectorTags = new Set(capturedTags.flat());

    const writeTags = observationWriteTags("basson", "weight_record");
    expect(writeTags).not.toContain(farmTag("basson", "camps"));
    expect(writeTags.some((t) => selectorTags.has(t))).toBe(true);
  });
});
