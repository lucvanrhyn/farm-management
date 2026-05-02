// @vitest-environment jsdom
/**
 * __tests__/components/animated-hero-tenant-leak.test.tsx
 *
 * Wave 57 / refs #24 — tenant context leak on the home hero image.
 *
 * Repro: Next.js does not unmount `app/[farmSlug]/home/page.tsx` when the
 * `[farmSlug]` segment changes — only re-renders. HomePage holds `heroImage`
 * in `useState`, initialized once at mount with `/farm-hero.jpg` and updated
 * via the `onHeroImageLoad` callback fired by AnimatedHero after `/api/farm`
 * resolves. When the user navigates basson-boerdery → trio-b-boerdery, the
 * useState retains the basson tenant's resolved `heroImageUrl` until the
 * trio-b fetch resolves. That gap renders basson's hero on a trio-b page.
 *
 * Fix: useState-pair pattern (memory/feedback-react-state-from-props.md) —
 * track the previous farmSlug in state, compare during render, and reset
 * `heroImage` to the neutral default the moment the slug flips.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import React from "react";

// next/navigation params are read once per render via useParams(). The
// mutable ref lets each test flip the farmSlug between renders so HomePage
// re-renders with a new prop-equivalent input — the same shape as the real
// dynamic-segment navigation that does NOT unmount the page tree.
const navParams: { farmSlug: string } = { farmSlug: "basson-boerdery" };
vi.mock("next/navigation", () => ({
  useParams: () => navParams,
  usePathname: () => `/${navParams.farmSlug}/home`,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// HomePage uses useFarmMode() — stub the provider so the component tree
// renders without a real FarmModeProvider mount.
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

// /api/farm responses keyed by farmSlug. We control resolution timing per
// test via deferred promises so the assertion can land precisely between
// the slug flip and the new fetch resolving.
const farmResponses: Record<
  string,
  { farmName: string; breed: string; heroImageUrl: string; animalCount: number; campCount: number }
> = {
  "basson-boerdery": {
    farmName: "Basson Boerdery",
    breed: "Bonsmara",
    heroImageUrl: "/uploads/basson-hero.jpg",
    animalCount: 103,
    campCount: 12,
  },
  "trio-b-boerdery": {
    farmName: "Trio B Boerdery",
    breed: "Brahman",
    heroImageUrl: "/uploads/trio-b-hero.jpg",
    animalCount: 270,
    campCount: 18,
  },
};

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let pendingFetches: Deferred<Response>[] = [];
const mockFetch = vi.fn();

beforeEach(() => {
  pendingFetches = [];
  navParams.farmSlug = "basson-boerdery";
  mockFetch.mockReset();
  // Each call returns a deferred we resolve manually so we can pin the
  // exact render between "fetch in-flight" and "fetch resolved".
  mockFetch.mockImplementation((_url: string) => {
    const slug = navParams.farmSlug;
    const d = deferred<Response>();
    pendingFetches.push(d);
    // Auto-resolve with the slug's payload only when the test explicitly
    // calls resolveNext(); otherwise the request stays pending.
    return d.promise.then(() => ({
      ok: true,
      json: async () => farmResponses[slug],
    }));
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
});

afterEach(() => {
  cleanup();
});

async function resolveNext() {
  const d = pendingFetches.shift();
  if (!d) throw new Error("no pending fetch to resolve");
  await act(async () => {
    d.resolve({} as Response);
    // Let the .then chain + state setters flush.
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("HomePage hero leak across farmSlug navigation (refs #24)", () => {
  it("does not render the previous tenant's heroImageUrl after the farmSlug flips", async () => {
    // Late import so vi.mock runs first.
    const { default: HomePage } = await import("@/app/[farmSlug]/home/page");

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<HomePage />);
    });

    // 1. Resolve basson's /api/farm. HomePage's heroImage state now holds
    //    /uploads/basson-hero.jpg.
    await resolveNext();

    const heroDiv = () => result.container.firstElementChild as HTMLElement;
    await waitFor(() => {
      expect(heroDiv().style.backgroundImage).toContain("/uploads/basson-hero.jpg");
    });

    // 2. Simulate the dynamic-segment navigation — Next.js re-renders the
    //    same HomePage instance with a new useParams() value.
    navParams.farmSlug = "trio-b-boerdery";
    await act(async () => {
      result.rerender(<HomePage />);
    });

    // 3. THE LEAK: between the prop flip and the new fetch resolving, the
    //    rendered hero must NOT still be the basson URL. With the bug the
    //    state is sticky and basson's URL is rendered on a trio-b page.
    expect(heroDiv().style.backgroundImage).not.toContain("/uploads/basson-hero.jpg");

    // 4. Sanity: once the new fetch resolves, the trio-b URL takes over.
    await resolveNext();
    await waitFor(() => {
      expect(heroDiv().style.backgroundImage).toContain("/uploads/trio-b-hero.jpg");
    });
  });
});
