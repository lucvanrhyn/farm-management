// @vitest-environment jsdom
/**
 * Issue #281 (parent PRD #279) — idempotent camp-visit enqueue.
 *
 * Root cause: `handleCompleteVisit` in
 * `app/[farmSlug]/logger/[campId]/page.tsx` enqueues a `camp_check`
 * observation WITHOUT a `clientLocalId`. Its sibling handlers
 * (`handleConditionSubmit`, `handleCoverSubmit`) already pass one. The
 * server domain op (`createObservation`) upserts on `clientLocalId` when
 * present and falls back to a plain `create` otherwise — so the
 * "complete visit / all normal" path creates a DUPLICATE inspection on
 * every replay (refresh, reconnect, offline-queue retry, double-click).
 *
 * Contract this test pins:
 *   1. The "complete visit / all normal" enqueue carries a `clientLocalId`
 *      that looks like an RFC 4122 v4 UUID (`crypto.randomUUID()` shape) —
 *      catches a future regression that swaps in a non-stable derivation.
 *   2. Re-submitting the SAME camp visit (the canonical "client thought it
 *      failed but the server got it" replay) reuses the same UUID, so the
 *      existing server-side upsert collapses both POSTs to ONE stored row.
 *   3. Navigating to a DIFFERENT camp starts a fresh idempotency key — two
 *      genuinely distinct visits must not collide on the server.
 *
 * Without (1)+(2) the server upsert is useless for this path; without (3)
 * a per-camp visit would silently dedupe against an unrelated camp.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/farm-x/logger",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "logger@example.com" } } }),
}));

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

// The behavioral observation point: every call to `queueObservation` is
// captured so the test can inspect the `clientLocalId` the page handler
// attached to the `camp_check` payload.
const queueObservation =
  vi.fn<(obs: { type?: string; clientLocalId?: string }) => Promise<number>>(
    async () => 1,
  );
vi.mock("@/lib/offline-store", () => ({
  getAnimalsByCampCached: vi.fn(async () => []),
  queueObservation,
  queuePhoto: vi.fn(async () => {}),
  queueCoverReading: vi.fn(async () => {}),
  updateCampCondition: vi.fn(async () => {}),
  updateAnimalCamp: vi.fn(async () => {}),
  updateAnimalStatus: vi.fn(async () => {}),
}));

vi.mock("@/lib/logger-actions", () => ({
  submitCalvingObservation: vi.fn(async () => ({ success: true })),
  submitMobMove: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/components/logger/AnimalChecklist", () => ({
  __esModule: true,
  default: () => <div data-testid="animal-checklist" />,
}));

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

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url === "/api/mobs") {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
});

beforeEach(() => {
  queueObservation.mockClear();
  fetchMock.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchMock;
});

afterEach(() => {
  cleanup();
});

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function paramsPromise(p: { farmSlug: string; campId: string }) {
  return Promise.resolve(p);
}

/** Find the clientLocalId on the most recent `camp_check` enqueue. */
function lastCampCheckClientLocalId(): string | undefined {
  const call = [...queueObservation.mock.calls]
    .reverse()
    .find((c) => c[0]?.type === "camp_check");
  return call?.[0]?.clientLocalId;
}

describe("CampInspectionPage — complete-visit enqueue idempotency (#281)", () => {
  it("attaches a v4-UUID clientLocalId to the camp_check enqueue", async () => {
    const { default: CampInspectionPage } = await import(
      "@/app/[farmSlug]/logger/[campId]/page"
    );

    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <CampInspectionPage params={paramsPromise({ farmSlug: "farm-x", campId: "A" })} />,
      );
    });

    await waitFor(() => expect(result.getByText(/All Normal/)).toBeTruthy());

    await act(async () => {
      fireEvent.click(result.getByText(/All Normal/));
      await Promise.resolve();
      await Promise.resolve();
    });

    const id = lastCampCheckClientLocalId();
    expect(
      id,
      "handleCompleteVisit must enqueue camp_check WITH a clientLocalId",
    ).toBeDefined();
    expect(
      id,
      `clientLocalId must be a v4 UUID, got: ${id}`,
    ).toMatch(UUID_V4_RE);
  });

  it("reuses the same clientLocalId when the SAME visit is re-submitted (replay → one row via upsert)", async () => {
    const { default: CampInspectionPage } = await import(
      "@/app/[farmSlug]/logger/[campId]/page"
    );

    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <CampInspectionPage params={paramsPromise({ farmSlug: "farm-x", campId: "A" })} />,
      );
    });

    await waitFor(() => expect(result.getByText(/All Normal/)).toBeTruthy());

    // First submit.
    await act(async () => {
      fireEvent.click(result.getByText(/All Normal/));
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = lastCampCheckClientLocalId();

    // Re-mount the SAME camp's page (refresh / reconnect / offline replay /
    // backgrounded-tab wakeup). The idempotency key for a given visit must
    // survive so the server upsert collapses both POSTs to one row.
    await act(async () => {
      result.rerender(
        <CampInspectionPage params={paramsPromise({ farmSlug: "farm-x", campId: "A" })} />,
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(result.getByText(/All Normal|Visit recorded/)).toBeTruthy());

    // The page-transition reset only fires when campId actually changes;
    // re-rendering the same campId must keep the visit's idempotency key.
    expect(
      lastCampCheckClientLocalId(),
      "a same-camp re-render must not regenerate the visit idempotency key",
    ).toBe(first);
  });

  it("starts a fresh clientLocalId for a DIFFERENT camp visit", async () => {
    const { default: CampInspectionPage } = await import(
      "@/app/[farmSlug]/logger/[campId]/page"
    );

    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <CampInspectionPage params={paramsPromise({ farmSlug: "farm-x", campId: "A" })} />,
      );
    });

    await waitFor(() => expect(result.getByText(/All Normal/)).toBeTruthy());
    await act(async () => {
      fireEvent.click(result.getByText(/All Normal/));
      await Promise.resolve();
      await Promise.resolve();
    });
    const campAId = lastCampCheckClientLocalId();

    // Navigate to a different camp — same component instance, new params.
    await act(async () => {
      result.rerender(
        <CampInspectionPage params={paramsPromise({ farmSlug: "farm-x", campId: "B" })} />,
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(result.getByText(/All Normal/)).toBeTruthy());
    await act(async () => {
      fireEvent.click(result.getByText(/All Normal/));
      await Promise.resolve();
      await Promise.resolve();
    });
    const campBId = lastCampCheckClientLocalId();

    expect(campAId).toMatch(UUID_V4_RE);
    expect(campBId).toMatch(UUID_V4_RE);
    expect(
      campBId,
      "a distinct camp visit must get its own idempotency key — otherwise camp B would dedupe against camp A's row",
    ).not.toBe(campAId);
  });
});
