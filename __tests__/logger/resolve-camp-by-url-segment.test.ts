/**
 * __tests__/logger/resolve-camp-by-url-segment.test.ts
 *
 * Issue #421 — Logger camp resolver was strict `===` on `camp_id` against
 * the URL `[campId]` segment. URLs that landed via deep link, QR code, or
 * shared link with case-drift from the stored canonical `camp_id` produced
 * a "Camp not found: <id>" 404 even though the camp existed in IndexedDB.
 *
 * Contract pinned here:
 *   - resolution is case-insensitive on BOTH sides (segment + camp_id)
 *   - exact-case lookups still resolve (no regression)
 *   - unrelated camps in the list don't false-match
 *   - URI-decoded segment is the caller's responsibility (page.tsx does
 *     `decodeURIComponent` before calling this); the resolver itself does
 *     not double-decode
 *
 * Why client-side: libSQL's Prisma adapter does NOT support
 * `mode: 'insensitive'` in `where` clauses, so a server-side
 * `prisma.camp.findFirst({ where: { campId: { equals, mode: 'insensitive' }}})`
 * throws at runtime. The Logger reads camps from IndexedDB via
 * `useOffline().camps` anyway, so the comparison rightly lives in the
 * client. See page.tsx for the matching comment on the call-site.
 */

import { describe, it, expect } from "vitest";
import { resolveCampByUrlSegment } from "@/app/[farmSlug]/logger/[campId]/_lib/resolve-camp-by-url-segment";
import type { Camp } from "@/lib/types";

// Minimal Camp fixture builder — only `camp_id` is load-bearing for the
// resolver; the rest of the shape is filler so the type checks.
function camp(id: string, overrides: Partial<Camp> = {}): Camp {
  return {
    camp_id: id,
    camp_name: id,
    size_hectares: 10,
    water_source: null,
    geojson: null,
    notes: null,
    ...overrides,
  } as Camp;
}

describe("resolveCampByUrlSegment — Issue #421", () => {
  it("resolves lowercase URL segment against an uppercase stored camp_id", () => {
    // Reproduces the bug: /<slug>/logger/a previously 404'd against camp 'A'.
    const camps = [camp("A"), camp("B")];
    const result = resolveCampByUrlSegment(camps, "a");
    expect(result?.camp_id).toBe("A");
  });

  it("resolves uppercase URL segment against a lowercase stored camp_id", () => {
    // Inverse of the bug — same case-drift class in the other direction.
    const camps = [camp("a"), camp("b")];
    const result = resolveCampByUrlSegment(camps, "A");
    expect(result?.camp_id).toBe("a");
  });

  it("resolves mixed-case URL segment against mixed-case stored camp_id", () => {
    // /<slug>/logger/Aa  against camp 'aA' (camel-vs-pascal style drift).
    const camps = [camp("aA"), camp("bB")];
    const result = resolveCampByUrlSegment(camps, "Aa");
    expect(result?.camp_id).toBe("aA");
  });

  it("still resolves exact-case match (no regression on existing happy path)", () => {
    // The all-uppercase /A → 'A' path was working before the fix.
    const camps = [camp("A")];
    const result = resolveCampByUrlSegment(camps, "A");
    expect(result?.camp_id).toBe("A");
  });

  it("returns undefined when no camp matches (preserves 404 path)", () => {
    const camps = [camp("A"), camp("B")];
    const result = resolveCampByUrlSegment(camps, "Z");
    expect(result).toBeUndefined();
  });

  it("returns undefined on empty camp list (logged-out / not-yet-loaded)", () => {
    expect(resolveCampByUrlSegment([], "anything")).toBeUndefined();
  });

  it("resolves every camp_id in a Basson-shaped fixture (9 camps, mixed casing)", () => {
    // Pins the acceptance criterion: all 9 Basson camps still resolve when
    // the URL segment matches their stored id under case-folding.
    const bassonCamps = [
      camp("RivierKamp"),
      camp("BoKraal"),
      camp("OnderVeld"),
      camp("Bergkamp"),
      camp("Skuurkamp"),
      camp("Langkamp"),
      camp("MiddelKamp"),
      camp("Vleikamp"),
      camp("Westhoek"),
    ];
    // Lowercase every segment — every camp must still resolve.
    for (const c of bassonCamps) {
      const result = resolveCampByUrlSegment(bassonCamps, c.camp_id.toLowerCase());
      expect(result?.camp_id).toBe(c.camp_id);
    }
  });

  it("resolves every camp_id in a Trio-shaped fixture (19 camps, mixed casing)", () => {
    // Pins the second half of the acceptance criterion (Trio's 19 camps).
    const trioCamps = Array.from({ length: 19 }, (_, i) =>
      camp(`Kamp${String.fromCharCode(65 + (i % 26))}${i}`),
    );
    for (const c of trioCamps) {
      // Flip casing of every segment — every camp must still resolve.
      const flipped = c.camp_id
        .split("")
        .map((ch) =>
          ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase(),
        )
        .join("");
      const result = resolveCampByUrlSegment(trioCamps, flipped);
      expect(result?.camp_id).toBe(c.camp_id);
    }
  });

  it("does not false-match: 'Kamp1' segment vs 'Kamp10' camp_id", () => {
    // Length-mismatched substrings must NOT collide — the comparison is
    // equality (lowercased), not startsWith / includes.
    const camps = [camp("Kamp10"), camp("Kamp1")];
    const result = resolveCampByUrlSegment(camps, "kamp1");
    expect(result?.camp_id).toBe("Kamp1");
  });
});
