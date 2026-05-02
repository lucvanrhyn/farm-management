// @vitest-environment jsdom
/**
 * __tests__/components/logger-camp-leak.test.tsx
 *
 * Wave 3 Agent A2 — logger camp state leak across [campId] navigation.
 *
 * Repro: Next.js does not unmount `app/[farmSlug]/logger/[campId]/page.tsx`
 * when only the `[campId]` dynamic segment changes — only re-renders. The
 * page holds 9 useState fields seeded once at mount with no campId-aware
 * reset. Navigating camp A → camp B leaks every one of them onto the new
 * camp's page until the next `useEffect` fires (animals/mobs) or until the
 * user manually closes a modal (activeModal/selectedAnimalId/selectedMob).
 *
 * Same class-of-bug as PR #59 (hero-image leak across [farmSlug]). Fix uses
 * the React-blessed useState-pair pattern (memory/feedback-react-state-from-props.md):
 * track the previous campId in state, compare during render, and reset all
 * 9 fields synchronously on mismatch — no extra render, no flicker.
 *
 * Wrong fixes (do NOT switch this test to assert these):
 *  - `key={params.campId}` on a wrapper — kills component identity, throws
 *    away non-stale state, breaks transitions.
 *  - `useRef` set during render — React 19 + Next 16 lint forbid.
 *  - `useEffect(() => setState(initial), [campId])` — visible flicker, one
 *    render of stale state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// next/navigation — useRouter is hit by the page; useParams is unused
// because the page reads params via React's `use(promise)` helper.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/farm-x/logger",
}));

// next-auth — page reads `session?.user?.name` for logged_by; null is fine.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}));

// FarmModeProvider stub — the page uses useFarmModeSafe() to filter animals.
vi.mock("@/lib/farm-mode", async () => {
  const actual = await vi.importActual<typeof import("@/lib/farm-mode")>(
    "@/lib/farm-mode",
  );
  return {
    ...actual,
    useFarmModeSafe: () => ({
      mode: "cattle",
      setMode: () => {},
      enabledModes: ["cattle"],
      isMultiMode: false,
    }),
  };
});

// OfflineProvider stub — the page reads `camps` (so the requested campId
// resolves to a real Camp), `campsLoaded` (gates the render past the
// loading splash), and a few setter callbacks the leak-path doesn't hit.
const camps = [
  { camp_id: "A", camp_name: "Camp Alpha", water_source: "borehole" },
  { camp_id: "B", camp_name: "Camp Bravo", water_source: "river" },
];
vi.mock("@/components/logger/OfflineProvider", () => ({
  useOffline: () => ({
    isOnline: true,
    syncStatus: "idle",
    pendingCount: 0,
    lastSyncedAt: null,
    syncResult: null,
    camps,
    campsLoaded: true,
    tasks: [],
    heroImageUrl: null,
    syncNow: vi.fn(async () => {}),
    refreshData: vi.fn(async () => {}),
    refreshPendingCount: vi.fn(async () => {}),
    refreshCampsState: vi.fn(async () => {}),
  }),
}));

// offline-store — IndexedDB-backed reads. The leak-path test only needs the
// animals query for whatever campId is currently rendered. Returning a
// stable empty array keeps animals state predictable; we drive the leak
// assertion through `selectedMob` + `mobsInCamp` instead.
vi.mock("@/lib/offline-store", () => ({
  getAnimalsByCampCached: vi.fn(async () => []),
  queueObservation: vi.fn(async () => "obs-1"),
  queuePhoto: vi.fn(async () => {}),
  queueCoverReading: vi.fn(async () => {}),
  updateCampCondition: vi.fn(async () => {}),
  updateAnimalCamp: vi.fn(async () => {}),
  updateAnimalStatus: vi.fn(async () => {}),
}));

// logger-actions — server-action wrappers; not exercised by the leak path.
vi.mock("@/lib/logger-actions", () => ({
  submitCalvingObservation: vi.fn(async () => ({ success: true })),
  submitMobMove: vi.fn(async () => ({ success: true })),
}));

// AnimalChecklist — renders nothing testable in this spec; replace with a
// passthrough stub so the dynamic flag wiring is observable but the inner
// component tree is irrelevant.
vi.mock("@/components/logger/AnimalChecklist", () => ({
  __esModule: true,
  default: () => <div data-testid="animal-checklist" />,
}));

// next/dynamic-loaded modal forms. We only need to detect their presence in
// the DOM via a stable test id, and to confirm they unmount when activeModal
// resets. A single shared stub factory keeps the spec compact.
function modalStub(testId: string) {
  return {
    __esModule: true,
    default: () => <div data-testid={testId} />,
  };
}
vi.mock("@/components/logger/HealthIssueForm", () => modalStub("modal-health"));
vi.mock("@/components/logger/MovementForm", () => modalStub("modal-movement"));
vi.mock("@/components/logger/CalvingForm", () => modalStub("modal-calving"));
vi.mock("@/components/logger/CampConditionForm", () => modalStub("modal-condition"));
vi.mock("@/components/logger/WeighingForm", () => modalStub("modal-weigh"));
vi.mock("@/components/logger/TreatmentForm", () => modalStub("modal-treat"));
vi.mock("@/components/logger/CampCoverLogForm", () => modalStub("modal-cover"));
vi.mock("@/components/logger/ReproductionForm", () => modalStub("modal-repro"));
vi.mock("@/components/logger/DeathModal", () => modalStub("modal-death"));
vi.mock("@/components/logger/MobMoveModal", () => modalStub("modal-mob-move"));

// /api/mobs is fetched on mount per campId — the page calls `/api/mobs`
// with no query and filters client-side by `current_camp === decodedId`.
// So we return the union of camp-A + camp-B mobs and let the page's filter
// pick the right rows on each render.
const allMobs: Array<{ id: string; name: string; current_camp: string; animal_count: number }> = [
  { id: "mob-A1", name: "Heifers A", current_camp: "A", animal_count: 5 },
  { id: "mob-B1", name: "Bulls B", current_camp: "B", animal_count: 3 },
];
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url === "/api/mobs") {
    return new Response(JSON.stringify(allMobs), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
});

beforeEach(() => {
  fetchMock.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchMock;
});

afterEach(() => {
  cleanup();
});

// Helper — wrap a literal params object as a resolved Promise the way Next 16
// page receives it (the page calls `use(params)` to unwrap).
function paramsPromise(p: { farmSlug: string; campId: string }) {
  return Promise.resolve(p);
}

describe("CampInspectionPage state leak across [campId] navigation (Wave 3 A2)", () => {
  it("resets selectedMob + activeModal synchronously when campId flips", async () => {
    const { default: CampInspectionPage } = await import(
      "@/app/[farmSlug]/logger/[campId]/page"
    );

    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(<CampInspectionPage params={paramsPromise({ farmSlug: "farm-x", campId: "A" })} />);
    });

    // Wait for /api/mobs to populate `mobsInCamp` so the "Move Mob" button
    // renders. Without this, the click that sets selectedMob is impossible.
    await waitFor(() => {
      expect(result.getByText(/Heifers A/)).toBeTruthy();
    });

    // Open the mob-move modal. This sets selectedMob + activeModal=mob_move
    // — two of the nine leaky useState fields.
    const moveBtn = result.getByText(/Move Mob/);
    await act(async () => {
      fireEvent.click(moveBtn);
    });

    expect(result.queryByTestId("modal-mob-move")).toBeTruthy();

    // Now simulate Next.js dynamic-segment navigation A → B. Same component
    // instance, new params Promise. With the bug the previous render's
    // selectedMob + activeModal stick: the mob-move modal stays mounted on
    // camp B. With the useState-pair fix they reset synchronously during
    // the transition render — no extra commit, no flicker.
    await act(async () => {
      result.rerender(
        <CampInspectionPage params={paramsPromise({ farmSlug: "farm-x", campId: "B" })} />,
      );
    });

    // Synchronous reset: the modal must be gone in the very same render
    // pass that swapped campId — no waitFor, no extra act.
    expect(result.queryByTestId("modal-mob-move")).toBeNull();

    // And the camp-B mob list takes over as its /api/mobs response resolves.
    await waitFor(() => {
      expect(result.getByText(/Bulls B/)).toBeTruthy();
    });

    // Sanity: no stale Heifers A row leaked into the camp-B render.
    expect(result.queryByText(/Heifers A/)).toBeNull();
  });

  it("resets allNormalDone (visit-recorded banner) when campId flips", async () => {
    const { default: CampInspectionPage } = await import(
      "@/app/[farmSlug]/logger/[campId]/page"
    );

    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(<CampInspectionPage params={paramsPromise({ farmSlug: "farm-x", campId: "A" })} />);
    });

    await waitFor(() => {
      expect(result.getByText(/All Normal/)).toBeTruthy();
    });

    // Click the "All Normal — Camp Good" button. handleCompleteVisit awaits
    // a chain of offline-store writes; with our mocks they resolve next-tick
    // and flip allNormalDone to true (rendering the green "Visit recorded"
    // banner) plus open the condition modal.
    const allNormalBtn = result.getByText(/All Normal/);
    await act(async () => {
      fireEvent.click(allNormalBtn);
      // Let the handler's awaited chain settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.queryByText(/Visit recorded/)).toBeTruthy();
    });

    // Flip campId — with the bug, the green banner stays on camp B until the
    // user re-clicks. With the fix it reverts to the orange action button.
    await act(async () => {
      result.rerender(
        <CampInspectionPage params={paramsPromise({ farmSlug: "farm-x", campId: "B" })} />,
      );
    });

    expect(result.queryByText(/Visit recorded/)).toBeNull();
    expect(result.getByText(/All Normal/)).toBeTruthy();
  });
});
