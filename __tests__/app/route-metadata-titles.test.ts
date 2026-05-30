import { describe, it, expect } from "vitest";
import type { Metadata } from "next";

/**
 * #110 — every high-value route segment must set a branded <title> via the
 * Next 16 Metadata API. Only the root layout exported `metadata` before this
 * change, so most routes rendered the bare "FarmTrack" root title (or nothing
 * once a deeper segment is involved).
 *
 * Client-component pages ('use client') CANNOT export `metadata` — Next 16
 * rejects non-reserved exports from client page modules at build time. For
 * those segments the title is set on the nearest SERVER layout instead
 * (e.g. the three `(auth)` pages each get a per-segment server layout, and
 * the onboarding wizard's client leaf pages inherit from its server layout).
 *
 * This test imports the SERVER modules that own each title and asserts the
 * resolved `metadata.title`. It is intentionally a representative sample, not
 * an exhaustive enumeration — enough to lock the convention and catch a
 * regression that drops a title or breaks the branded "— FarmTrack" suffix.
 *
 * Importing a layout/page module only evaluates its top-level exports; the
 * default-export component function is never invoked here, so the async
 * auth/DB work inside those components does not run.
 */

const BRAND = "FarmTrack";

/** Pull a plain-string title out of a module's exported metadata. */
function titleOf(mod: { metadata?: Metadata }): string {
  const t = mod.metadata?.title;
  // We only ever set plain-string titles in this codebase.
  return typeof t === "string" ? t : "";
}

describe("#110 — per-route branded page titles", () => {
  const cases: Array<{
    name: string;
    load: () => Promise<{ metadata?: Metadata }>;
    expected: string;
  }> = [
    // (auth) — client pages; title lives on a per-segment SERVER layout.
    {
      name: "(auth)/login/layout",
      load: () => import("@/app/(auth)/login/layout"),
      expected: `Sign In — ${BRAND}`,
    },
    {
      name: "(auth)/register/layout",
      load: () => import("@/app/(auth)/register/layout"),
      expected: `Register — ${BRAND}`,
    },
    {
      name: "(auth)/verify-email/layout",
      load: () => import("@/app/(auth)/verify-email/layout"),
      expected: `Verify Email — ${BRAND}`,
    },
    // [farmSlug] segment layouts (server).
    {
      name: "[farmSlug]/admin/layout",
      load: () => import("@/app/[farmSlug]/admin/layout"),
      expected: `Admin — ${BRAND}`,
    },
    {
      name: "[farmSlug]/dashboard/layout",
      load: () => import("@/app/[farmSlug]/dashboard/layout"),
      expected: `Dashboard — ${BRAND}`,
    },
    {
      name: "[farmSlug]/sheep/layout",
      load: () => import("@/app/[farmSlug]/sheep/layout"),
      expected: `Sheep — ${BRAND}`,
    },
    {
      name: "[farmSlug]/tools/layout",
      load: () => import("@/app/[farmSlug]/tools/layout"),
      expected: `Tools — ${BRAND}`,
    },
    {
      name: "[farmSlug]/game/layout",
      load: () => import("@/app/[farmSlug]/game/layout"),
      expected: `Game — ${BRAND}`,
    },
    {
      name: "[farmSlug]/onboarding/layout",
      load: () => import("@/app/[farmSlug]/onboarding/layout"),
      expected: `Onboarding — ${BRAND}`,
    },
    // Server pages that own their own title.
    {
      name: "[farmSlug]/home/page",
      load: () => import("@/app/[farmSlug]/home/page"),
      expected: `Home — ${BRAND}`,
    },
    {
      name: "[farmSlug]/logger/page",
      load: () => import("@/app/[farmSlug]/logger/page"),
      expected: `Logger — ${BRAND}`,
    },
    {
      // Client leaf page + client parent layout → title owned by a thin
      // server layout inserted between them.
      name: "[farmSlug]/logger/[campId]/layout",
      load: () => import("@/app/[farmSlug]/logger/[campId]/layout"),
      expected: `Logger — ${BRAND}`,
    },
    // Top-level authenticated / billing routes (server layouts).
    {
      name: "farms/layout",
      load: () => import("@/app/farms/layout"),
      expected: `Your Farms — ${BRAND}`,
    },
    {
      name: "subscribe/layout",
      load: () => import("@/app/subscribe/layout"),
      expected: `Subscribe — ${BRAND}`,
    },
    {
      name: "offline/layout",
      load: () => import("@/app/offline/layout"),
      expected: `Offline — ${BRAND}`,
    },
  ];

  for (const c of cases) {
    it(`${c.name} → "${c.expected}"`, async () => {
      const mod = await c.load();
      expect(titleOf(mod)).toBe(c.expected);
    });
  }

  it("every branded title ends with the — FarmTrack suffix", async () => {
    for (const c of cases) {
      const mod = await c.load();
      expect(titleOf(mod)).toMatch(/ — FarmTrack$/);
    }
  });
});
