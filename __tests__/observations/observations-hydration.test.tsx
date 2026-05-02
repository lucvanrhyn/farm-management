// @vitest-environment jsdom
/**
 * __tests__/observations/observations-hydration.test.tsx
 *
 * Wave 3 / refs #418 — observations admin page React #418 hydration mismatch
 * regression lock.
 *
 * Class-of-bug context (memory: feedback-react-state-from-props.md +
 * Phase M2 2026-04-27 date-formatter centralisation):
 *   React #418 ("Hydration failed because the server rendered HTML didn't
 *   match the client") on FarmTrack has historically been driven by:
 *     1. SSR/CSR `Intl.DateTimeFormat()` / `toLocaleDateString()` /
 *        `Date.toString()` calls without a pinned `locale` + `timeZone`,
 *        which render differently on a Vercel function (UTC) than in a
 *        Cape Town browser (Africa/Johannesburg, en-ZA).
 *     2. `Date.now()` / `Math.random()` evaluated at render time — different
 *        values on server vs client.
 *     3. `useState`-initial-from-prop drift caused by the page tree NOT
 *        unmounting across `[farmSlug]` navigation (the leak class fixed in
 *        PR #59 with the useState-pair pattern).
 *
 * What this test asserts:
 *   The serialised SSR markup of <ObservationsPageClient /> hydrates cleanly
 *   in jsdom — i.e. React's hydration pass emits NO `console.error` whose
 *   message is the #418 family ("Hydration failed", "did not match",
 *   "Text content does not match server-rendered HTML"). The test renders
 *   with the props the server page actually passes (camps[], animals[],
 *   species), then checks that hydration is silent.
 *
 * Why locking instead of reproducing:
 *   The Wave 3 dispatch grep over the allow-list (page.tsx,
 *   ObservationsPageClient.tsx, loading.tsx) and the components they render
 *   (ObservationsLog → Filters/ObservationRow/Pagination/EditModal/fields,
 *   CreateObservationModal, ClearSectionButton, AnimalPicker, AdminPage) found
 *   ZERO occurrences of `toLocaleString` / `toLocaleDateString` /
 *   `toLocaleTimeString` / `new Intl.DateTimeFormat` / `Date.now()` /
 *   `Math.random()` in any render path. The single `new Date().toISOString()`
 *   in CreateObservationModal sits inside a click handler (handleSubmit),
 *   not the render body — it cannot drift between SSR and CSR.
 *
 *   The page also does not render any non-deterministic content in SSR:
 *   ObservationsLog's initial state has `loading=true`, so the "No
 *   observations found." gating expression `!loading && observations.length
 *   === 0` is false, the observations list is empty, the editTarget is null
 *   (no modal), the camps array is empty (no <option>s beyond "All Camps").
 *
 *   Given the surface is currently clean, this spec is a forward-looking
 *   lock: any new component added to the observations admin tree that
 *   reintroduces a date-formatter / random-number / sticky-state pattern
 *   without going through the centralised `en-ZA` + `Africa/Johannesburg`
 *   formatter contract will fail this test before it reaches users.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act } from "react";
import React from "react";

// next/navigation is touched transitively by ClearSectionButton's useRouter
// hook. Stub the surface ObservationsPageClient + descendants need so the
// hydration pass doesn't blow up on a missing app-router context.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b-boerdery/admin/observations",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ farmSlug: "trio-b-boerdery" }),
}));

// Silence the live /api/camps + /api/observations fetches that
// ObservationsLog kicks off in useEffect right after hydration. The
// hydration-mismatch check finishes before any fetch resolves; we just need
// fetch to exist and not throw.
const mockFetch = vi.fn(async () => ({
  ok: true,
  json: async () => [],
}));

beforeEach(() => {
  mockFetch.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const HYDRATION_ERROR_PATTERNS = [
  /Hydration failed/i,
  /did not match/i,
  /Text content does not match/i,
  /server rendered HTML/i,
  /minified React error #418/i,
];

function isHydrationError(args: unknown[]): boolean {
  for (const arg of args) {
    if (typeof arg !== "string") continue;
    if (HYDRATION_ERROR_PATTERNS.some((p) => p.test(arg))) return true;
  }
  return false;
}

describe("admin/observations — hydration #418 lock", () => {
  it("ObservationsPageClient SSR markup hydrates without a #418 mismatch", async () => {
    const { default: ObservationsPageClient } = await import(
      "@/app/[farmSlug]/admin/observations/ObservationsPageClient"
    );

    // Same prop shape the server page emits at app/[farmSlug]/admin/
    // observations/page.tsx — empty camps + animals is the realistic
    // first-paint path for a small farm and is also the worst-case for SSR
    // markup determinism (no list items to drift on).
    const tree = (
      <ObservationsPageClient
        camps={[
          { id: "camp-1", name: "Camp 1" },
          { id: "camp-2", name: "Camp 2" },
        ]}
        animals={[
          { id: "C0001", tag: "C0001", campId: "camp-1" },
          { id: "C0002", tag: "C0002", campId: "camp-1" },
        ]}
        species="cattle"
      />
    );

    const ssrHtml = renderToString(tree);

    // Spy on console.error before hydrateRoot — that's where React surfaces
    // the #418 family of mismatches.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const container = document.createElement("div");
    container.innerHTML = ssrHtml;
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      await act(async () => {
        root = hydrateRoot(container, tree);
      });

      // Collect any hydration-shaped error(s) the spy captured.
      const hydrationErrors = errorSpy.mock.calls.filter(isHydrationError);

      expect(
        hydrationErrors,
        // Surface the actual error payload(s) on failure so future
        // regressions name the offending component immediately.
        `expected zero hydration errors, got:\n${JSON.stringify(
          hydrationErrors,
          null,
          2,
        )}`,
      ).toEqual([]);
    } finally {
      // Tear down the React root before the spy is restored so post-unmount
      // diagnostics (if any) don't pollute the next spec.
      await act(async () => {
        root?.unmount();
      });
      container.remove();
      errorSpy.mockRestore();
    }
  });
});
