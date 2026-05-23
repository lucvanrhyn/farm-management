// @vitest-environment jsdom
/**
 * __tests__/components/logger-camp-selector-mode-filter.test.tsx
 *
 * Wave 2 — issue #234 — Logger camp tiles filter by FarmMode.
 *
 * Root cause (pre-fix): the Vision Logger camp picker reads camps from
 * `useOffline().camps`, which is hydrated from `/api/camps` →
 * `getCachedCampList`. That cached helper's `camp.findMany` carries NO
 * `species` filter (only `animal.groupBy` is mode-scoped). So when a
 * cattle operator opens the logger on a multi-species tenant, sheep and
 * game camps appear in the picker — a real data-corruption risk because
 * a cattle inspection logged against a sheep camp will downstream-feed
 * into the wrong species' Einstein RAG slice.
 *
 * Fix shape (per the issue + facade contract from #224): the server page
 * pre-fetches camps via `scoped(prisma, mode).camp.findMany` and passes
 * the species-scoped Camp IDs to <CampSelector /> as an
 * `allowedCampIds: Set<string>` prop. CampSelector filters the IDB-
 * backed `useOffline().camps` against the allowlist before rendering
 * tiles. The IDB cache itself is not species-aware (no `species` field
 * on the offline Camp shape) — the allowlist comes from the authoritative
 * server fetch, which IS species-scoped via the facade.
 *
 * Offline-queue boundary (ADR-0002): the picker change does NOT touch
 * `lib/sync-manager.ts`, `lib/sync/queue.ts`, or `lib/offline-store.ts`.
 * A sheep-camp observation queued BEFORE this fix (when the picker
 * leaked sheep camps to a cattle operator) must still flush on next
 * sync — the queue is keyed by observation id + sync kind, not by camp
 * species, and the post-fix picker can't change historical queue rows.
 * The third test below pins this.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

// ── next/navigation ────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ farmSlug: "trio-b" }),
}));

// ── FarmModeProvider ───────────────────────────────────────────────────
// Default to cattle mode for the first test; we re-mock per test for sheep.
const farmModeMock = vi.hoisted(() => ({
  current: { mode: "cattle", isMultiMode: true, enabledModes: ["cattle", "sheep"], setMode: () => {} },
}));
vi.mock("@/lib/farm-mode", async () => {
  const actual = await vi.importActual<typeof import("@/lib/farm-mode")>("@/lib/farm-mode");
  return {
    ...actual,
    useFarmModeSafe: () => farmModeMock.current,
  };
});

// ── ModeSwitcher (decorative, not under test) ─────────────────────────
vi.mock("@/components/ui/ModeSwitcher", () => ({
  __esModule: true,
  ModeSwitcher: () => <div data-testid="mode-switcher" />,
}));

// ── OfflineProvider — supplies the cross-species `camps` from IDB ──────
// Three camps: A=cattle, B=sheep, C=cattle. The picker pre-fix renders
// all three regardless of mode. Held in a hoisted ref so the empty-state
// / skeleton tests (issue #370) can swap in an empty IDB list.
const ALL_CAMPS = [
  { camp_id: "A", camp_name: "Cattle Camp Alpha", animal_count: 5, grazing_quality: "Good" as const },
  { camp_id: "B", camp_name: "Sheep Camp Bravo", animal_count: 3, grazing_quality: "Good" as const },
  { camp_id: "C", camp_name: "Cattle Camp Charlie", animal_count: 8, grazing_quality: "Good" as const },
];
const offlineMock = vi.hoisted(() => ({
  current: { camps: [] as Array<Record<string, unknown>> },
}));
vi.mock("@/components/logger/OfflineProvider", () => ({
  useOffline: () => offlineMock.current,
}));

import CampSelector from "@/components/logger/CampSelector";

beforeEach(() => {
  offlineMock.current = { camps: ALL_CAMPS };
});

afterEach(() => {
  cleanup();
  farmModeMock.current = { mode: "cattle", isMultiMode: true, enabledModes: ["cattle", "sheep"], setMode: () => {} };
  offlineMock.current = { camps: ALL_CAMPS };
});

describe("<CampSelector /> — FarmMode filter (issue #234)", () => {
  it("in cattle mode + allowedCampIds={A,C}, renders only cattle camps (A, C)", () => {
    farmModeMock.current = { mode: "cattle", isMultiMode: true, enabledModes: ["cattle", "sheep"], setMode: () => {} };

    const { queryByText } = render(
      <CampSelector allowedCampIds={new Set(["A", "C"])} />,
    );

    expect(queryByText("Cattle Camp Alpha")).toBeTruthy();
    expect(queryByText("Cattle Camp Charlie")).toBeTruthy();
    // Sheep camp must NOT appear — this is the data-corruption defence.
    expect(queryByText("Sheep Camp Bravo")).toBeNull();
  });

  it("in sheep mode + allowedCampIds={B}, renders only the sheep camp (B)", () => {
    farmModeMock.current = { mode: "sheep", isMultiMode: true, enabledModes: ["cattle", "sheep"], setMode: () => {} };

    const { queryByText } = render(
      <CampSelector allowedCampIds={new Set(["B"])} />,
    );

    expect(queryByText("Sheep Camp Bravo")).toBeTruthy();
    expect(queryByText("Cattle Camp Alpha")).toBeNull();
    expect(queryByText("Cattle Camp Charlie")).toBeNull();
  });

  it("renders all IDB camps (back-compat) when allowedCampIds is undefined", () => {
    // Back-compat path: existing harnesses + offline-only paint where the
    // server prop has not yet hydrated. The component must not crash and
    // must render the full IDB-backed list. This is also the path that
    // protects the offline-queue boundary — a sheep-camp observation that
    // was queued BEFORE this fix still has a real camp tile to navigate
    // back to until the next sync, and the queue itself (untouched by
    // this change) keeps flushing it regardless of which tile the user
    // sees today.
    farmModeMock.current = { mode: "cattle", isMultiMode: true, enabledModes: ["cattle", "sheep"], setMode: () => {} };

    const { queryByText } = render(<CampSelector />);

    expect(queryByText("Cattle Camp Alpha")).toBeTruthy();
    expect(queryByText("Sheep Camp Bravo")).toBeTruthy();
    expect(queryByText("Cattle Camp Charlie")).toBeTruthy();
  });
});

/**
 * Issue #370 — species-aware empty state in the Sheep Logger CampSelector.
 *
 * Three distinct states the component must keep separate:
 *   1. `camps.length === 0`                        → skeleton LOADING grid
 *      (the IDB cache has not hydrated yet — unchanged by this issue).
 *   2. `visibleCamps.length === 0` && `camps > 0`  → species-aware EMPTY
 *      state ("No sheep camps yet …"). Camps exist on the farm, but the
 *      `allowedCampIds` / FarmMode filter leaves none visible for the
 *      active species. Pre-fix this rendered a blank tile grid that
 *      looked like broken data.
 *   3. `visibleCamps.length > 0`                   → the tile grid.
 *
 * These tests pin states 1 and 2; the FarmMode-filter suite above already
 * covers state 3.
 */
describe("<CampSelector /> — species-aware empty state (issue #370)", () => {
  it("on a sheep farm with no visible sheep camps, shows the empty state (not a blank grid)", () => {
    // IDB has camps (3 cattle/sheep camps) but the server allowlist for
    // sheep mode matches none of them → state 2.
    farmModeMock.current = { mode: "sheep", isMultiMode: true, enabledModes: ["cattle", "sheep"], setMode: () => {} };

    const { queryByTestId, queryByText } = render(
      <CampSelector allowedCampIds={new Set<string>()} />,
    );

    // Species-aware copy — phrased for the active species.
    const empty = queryByTestId("camp-selector-empty-state");
    expect(empty).toBeTruthy();
    expect(empty!.textContent?.toLowerCase()).toContain("no sheep camps yet");
    // None of the IDB camps may render as a tile — the bug is a blank grid.
    expect(queryByText("Cattle Camp Alpha")).toBeNull();
    expect(queryByText("Sheep Camp Bravo")).toBeNull();
    expect(queryByText("Cattle Camp Charlie")).toBeNull();
  });

  it("the empty-state copy is species-aware (cattle mode says 'cattle camps')", () => {
    farmModeMock.current = { mode: "cattle", isMultiMode: true, enabledModes: ["cattle", "sheep"], setMode: () => {} };

    const { queryByTestId } = render(
      <CampSelector allowedCampIds={new Set<string>()} />,
    );

    const empty = queryByTestId("camp-selector-empty-state");
    expect(empty).toBeTruthy();
    expect(empty!.textContent?.toLowerCase()).toContain("no cattle camps yet");
  });

  it("does NOT show the empty state while the IDB cache is still loading (camps.length === 0 keeps the skeleton)", () => {
    // State 1 — the LOADING skeleton. Distinct from state 2: no camps in
    // IDB yet, so we cannot know whether the farm has zero sheep camps.
    farmModeMock.current = { mode: "sheep", isMultiMode: true, enabledModes: ["cattle", "sheep"], setMode: () => {} };
    offlineMock.current = { camps: [] };

    const { queryByTestId, container } = render(
      <CampSelector allowedCampIds={new Set<string>()} />,
    );

    // The empty state must NOT appear — that would mislabel "loading" as
    // "no camps".
    expect(queryByTestId("camp-selector-empty-state")).toBeNull();
    // The skeleton loader (6 animate-pulse tiles) is unchanged.
    expect(container.querySelectorAll(".animate-pulse").length).toBe(6);
  });
});

/**
 * Issue #382 — the CampEmptyState body copy rendered a glued-together
 * "Add a sheepcamp to start logging." in production (confirmed live via
 * the DOM accessibility tree).
 *
 * Root cause: same build-time JSX/SWC whitespace strip as #369 / PR #379.
 * The `CampEmptyState` heading + paragraph each have a literal-space text
 * node (" camps yet" / " camp to start logging.") immediately following a
 * `{speciesLabel}` expression. The transform drops the leading space of a
 * text node that follows an `{expression}`, so the source space vanishes
 * in the production bundle even though jsdom renders it fine.
 *
 * Regression is from PR #381, which added `CampEmptyState`.
 *
 * Two-layer lock, mirroring __tests__/admin/dashboard-low-grazing-alert-
 * spacing.test.tsx:
 *  1. Render layer — the rendered empty-state textContent must read
 *     "sheep camp" / "No sheep camps yet" with the spaces (acceptance
 *     criterion).
 *  2. Source layer — the JSX must pin both spaces with an explicit `{" "}`
 *     after `{speciesLabel}`, not a bare literal space. A literal space
 *     renders identically in jsdom, so only this source-layer assertion
 *     actually fails if the `{" "}` fix is reverted — it is the genuine
 *     guard against the production-only strip.
 */
describe("<CampSelector /> — empty-state copy spacing (issue #382)", () => {
  it("renders the empty-state copy with spaces ('No sheep camps yet', 'sheep camp to start')", () => {
    farmModeMock.current = { mode: "sheep", isMultiMode: true, enabledModes: ["cattle", "sheep"], setMode: () => {} };

    const { queryByTestId } = render(
      <CampSelector allowedCampIds={new Set<string>()} />,
    );

    const empty = queryByTestId("camp-selector-empty-state");
    expect(empty).toBeTruthy();
    const text = empty!.textContent ?? "";

    // Heading — the word boundary between "sheep" and "camps" must exist.
    expect(text).toContain("No sheep camps yet");
    expect(text).not.toContain("sheepcamps");
    // Body — the production bug: "sheepcamp" with no space.
    expect(text).toContain("Add a sheep camp to start logging.");
    expect(text).not.toContain("sheepcamp");
  });

  it("uses an explicit {\" \"} after {speciesLabel} in the empty-state copy (not a bare literal space)", async () => {
    /**
     * The production-only SWC whitespace strip cannot be reproduced in
     * jsdom, so this source-level assertion is what genuinely locks the
     * regression: the space between `{speciesLabel}` and the following
     * `camp`/`camps` text MUST be an explicit `{" "}` JSX expression on
     * both the heading and the paragraph.
     */
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const src = await readFile(
      join(__dirname, "..", "..", "components", "logger", "CampSelector.tsx"),
      "utf-8",
    );

    // Heading: `{speciesLabel}` then explicit {" "} then `camps yet`.
    expect(src).toMatch(/\{speciesLabel\}\{"\s"\}\s*camps yet/);
    // Paragraph: `{speciesLabel}` then explicit {" "} then `camp to start`.
    expect(src).toMatch(/\{speciesLabel\}\{"\s"\}\s*camp to start logging\./);

    // Negative guards: `{speciesLabel}` must NOT be followed directly by a
    // bare ` camp(s)` text node — that literal-space construct is the
    // latent defect that strips in production.
    expect(src).not.toMatch(/\{speciesLabel\}\s+camps yet/);
    expect(src).not.toMatch(/\{speciesLabel\}\s+camp to start logging\./);
  });
});
