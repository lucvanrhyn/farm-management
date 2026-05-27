// @vitest-environment jsdom
/**
 * __tests__/components/animated-hero-tenant-leak.test.tsx
 *
 * Wave 57 / refs #24 — tenant context leak on the home hero image.
 *
 * ORIGINAL REPRO (pre-#438):
 * Next.js does not unmount `app/[farmSlug]/home/page.tsx` when the
 * `[farmSlug]` segment changes — only re-renders. HomePage held `heroImage`
 * in `useState`, initialized once at mount with `/farm-hero.jpg` and updated
 * via the `onHeroImageLoad` callback fired by AnimatedHero after `/api/farm`
 * resolves. When the user navigated acme-cattle → delta-livestock, the
 * useState retained the first tenant's resolved `heroImageUrl` until the
 * second tenant's fetch resolved. That gap rendered the wrong tenant's hero.
 *
 * FIX (issue #438 / PRD #434):
 * `app/[farmSlug]/home/page.tsx` is now an async RSC. The tenant-leak class
 * is structurally eliminated: each navigation to `/<slug>/home` is a fresh
 * server-render with `getFarmIdentity(slug)` called per-request. There is no
 * `useState`-based hero URL that can persist across slug navigations.
 *
 * This test now verifies the NEW contract:
 *   - `HomePageClient` renders the background image directly from the
 *     `initialFarmData` prop on first paint — no client-side fetch,
 *     no loading state, no useState accumulation.
 *   - Re-rendering `HomePageClient` with a different `initialFarmData`
 *     immediately reflects the new hero image (no lag / no leak).
 *   - `AnimatedHero` renders the branded farm name from `initialFarmData`
 *     on first paint.
 *
 * The old `/api/farm` fetch path no longer exists in the component tree.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import type { FarmIdentity } from "@/lib/domain/farm/get-farm-identity";

// HomePageClient uses useFarmMode() — stub the provider.
vi.mock("@/lib/farm-mode", async () => {
  const actual = await vi.importActual<typeof import("@/lib/farm-mode")>(
    "@/lib/farm-mode",
  );
  return {
    ...actual,
    useFarmMode: () => ({
      mode: "cattle",
      setMode: () => {},
      enabledModes: ["cattle"],
      isMultiMode: false,
    }),
  };
});

// next/dynamic loads HomeSectionGrid via an async chunk. In jsdom we just
// render a placeholder so the dynamic import doesn't drag framer-motion in.
vi.mock("@/components/home/HomeSectionGrid", () => ({
  __esModule: true,
  default: () => <div data-testid="home-section-grid" />,
}));

// next-auth/react signOut is unused in the leak path — stub it.
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

// ModeSwitcher renders nothing in single-mode farms but jsdom still needs
// a no-op so the import resolves cleanly.
vi.mock("@/components/ui/ModeSwitcher", () => ({
  ModeSwitcher: () => null,
}));

afterEach(() => {
  cleanup();
});

const ACME_IDENTITY: FarmIdentity = {
  farmName: "Acme Cattle",
  breed: "Bonsmara",
  heroImageUrl: "/uploads/basson-hero.jpg",
  animalCount: 103,
  campCount: 12,
};

const DELTA_IDENTITY: FarmIdentity = {
  farmName: "Delta Livestock",
  breed: "Brahman",
  heroImageUrl: "/uploads/trio-b-hero.jpg",
  animalCount: 270,
  campCount: 18,
};

describe("HomePageClient hero — no tenant leak across initialFarmData prop changes (refs #24, #438)", () => {
  it("renders the correct background image from initialFarmData on first paint (no fetch required)", async () => {
    const { default: HomePageClient } = await import(
      "@/app/[farmSlug]/home/HomePageClient"
    );

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <HomePageClient farmSlug="acme-cattle" initialFarmData={ACME_IDENTITY} />,
      );
    });

    const heroDiv = () => result.container.firstElementChild as HTMLElement;

    // The background image must be set from the prop on first paint —
    // no useEffect fetch, no loading gap.
    expect(heroDiv().style.backgroundImage).toContain("/uploads/basson-hero.jpg");
  });

  it("immediately reflects new initialFarmData when the prop changes (no stale state leak)", async () => {
    const { default: HomePageClient } = await import(
      "@/app/[farmSlug]/home/HomePageClient"
    );

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <HomePageClient farmSlug="acme-cattle" initialFarmData={ACME_IDENTITY} />,
      );
    });

    const heroDiv = () => result.container.firstElementChild as HTMLElement;

    // First render: acme hero
    expect(heroDiv().style.backgroundImage).toContain("/uploads/basson-hero.jpg");

    // Simulate slug navigation: re-render with the new tenant's initialFarmData.
    // With the RSC pattern the server provides fresh initialFarmData per slug,
    // so the client component receives a new prop immediately — no fetch gap.
    await act(async () => {
      result.rerender(
        <HomePageClient
          farmSlug="delta-livestock"
          initialFarmData={DELTA_IDENTITY}
        />,
      );
    });

    // The new hero image must be in place immediately — no stale state from ACME_IDENTITY.
    expect(heroDiv().style.backgroundImage).toContain("/uploads/trio-b-hero.jpg");
    expect(heroDiv().style.backgroundImage).not.toContain("/uploads/basson-hero.jpg");
  });

  it("renders branded farm name from initialFarmData in AnimatedHero on first paint", async () => {
    const { default: HomePageClient } = await import(
      "@/app/[farmSlug]/home/HomePageClient"
    );

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <HomePageClient farmSlug="delta-livestock" initialFarmData={DELTA_IDENTITY} />,
      );
    });

    // Farm name must be in the DOM on first paint.
    expect(result.container.textContent).toContain("Delta Livestock");

    // The subtitle "Brahman Farm Management System" is correctly branded.
    // What we must NOT see is the legacy standalone fallback "—" that appeared
    // when the old client-side fetch was in-flight (the subtitle was just
    // "— Farm Management System" with a bare em-dash). Assert the breed prefix
    // is part of the subtitle text, not a standalone fallback.
    expect(result.container.textContent).toContain("Brahman Farm Management System");

    // The solo "—" placeholder that appeared before data loaded must be absent.
    // The subtitle always starts with a breed name now, never a lone dash.
    expect(result.container.textContent).not.toMatch(/^—\s+Farm Management System/m);
  });
});
