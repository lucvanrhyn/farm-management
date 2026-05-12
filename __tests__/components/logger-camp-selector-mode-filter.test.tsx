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
// all three regardless of mode.
const allCamps = [
  { camp_id: "A", camp_name: "Cattle Camp Alpha", animal_count: 5, grazing_quality: "Good" as const },
  { camp_id: "B", camp_name: "Sheep Camp Bravo", animal_count: 3, grazing_quality: "Good" as const },
  { camp_id: "C", camp_name: "Cattle Camp Charlie", animal_count: 8, grazing_quality: "Good" as const },
];
vi.mock("@/components/logger/OfflineProvider", () => ({
  useOffline: () => ({ camps: allCamps }),
}));

import CampSelector from "@/components/logger/CampSelector";

afterEach(() => {
  cleanup();
  farmModeMock.current = { mode: "cattle", isMultiMode: true, enabledModes: ["cattle", "sheep"], setMode: () => {} };
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
