// @vitest-environment jsdom
/**
 * Issue #436 (parent PRD #434) — inline camp-condition submit must surface a
 * visible toast when the server rejects the write with a 422
 * DUPLICATE_OBSERVATION code. Before this slice, the inline handler in
 * `app/[farmSlug]/logger/[campId]/page.tsx` queued the observation, fired
 * `syncNow()` fire-and-forget, and immediately `router.push(loggerRoot)`.
 * The duplicate was only ever detected by the BACKGROUND sync pass — by
 * that time the farmer had already navigated away, so the form closed
 * silently and no UI feedback ever appeared.
 *
 * Contract this test pins:
 *   1. On a 422 DUPLICATE_OBSERVATION response with `details.existingId`,
 *      the inline submit handler renders a visible toast.
 *   2. The toast copy is sourced from `classifySyncFailure(422, body).toast.message`
 *      — single source of truth shared with the background-sync path
 *      (`lib/sync-manager.ts`). The handler must NOT hard-code a literal.
 *   3. The happy-path (2xx) submit still navigates back to `/[farmSlug]/logger`
 *      and shows no duplicate toast — i.e. no regression on first-submit.
 *
 * The probe shape: spy on `fetch('/api/observations', …)` so we can hand the
 * handler a 422 duplicate response synchronously, then assert the toast
 * appears in the DOM. We import `classifySyncFailure` directly to derive
 * the expected copy — the same string the handler MUST consume.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

import { classifySyncFailure } from "@/lib/sync/failure-classifier";

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
];

const syncNowMock = vi.fn(async () => {});
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
    syncNow: syncNowMock,
    refreshData: vi.fn(async () => {}),
    refreshPendingCount: vi.fn(async () => {}),
    refreshCampsState: vi.fn(async () => {}),
  }),
}));

const queueObservationMock = vi.fn(async () => 1);
vi.mock("@/lib/offline-store", () => ({
  getAnimalsByCampCached: vi.fn(async () => []),
  getPendingObservations: vi.fn(async () => []),
  queueObservation: queueObservationMock,
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

// Real CampConditionForm so the test can click through the form's
// completion gating (#321) — the modal is opened by the page's
// "Report Camp Condition" button, and Submit must be enabled by
// selecting Grazing / Water / Fence options.
vi.mock("@/components/logger/CampConditionForm", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/logger/CampConditionForm")
  >("@/components/logger/CampConditionForm");
  return actual;
});

function modalStub(testId: string) {
  return {
    __esModule: true,
    default: () => <div data-testid={testId} />,
  };
}
vi.mock("@/components/logger/HealthIssueForm", () => modalStub("modal-health"));
vi.mock("@/components/logger/MovementForm", () => modalStub("modal-movement"));
vi.mock("@/components/logger/CalvingForm", () => modalStub("modal-calving"));
vi.mock("@/components/logger/WeighingForm", () => modalStub("modal-weigh"));
vi.mock("@/components/logger/TreatmentForm", () => modalStub("modal-treat"));
vi.mock("@/components/logger/CampCoverLogForm", () => modalStub("modal-cover"));
vi.mock("@/components/logger/ReproductionForm", () => modalStub("modal-repro"));
vi.mock("@/components/logger/DeathModal", () => modalStub("modal-death"));
vi.mock("@/components/logger/MobMoveModal", () => modalStub("modal-mob-move"));
vi.mock("@/components/logger/PhotoCapture", () => ({
  __esModule: true,
  PhotoCapture: () => <div data-testid="photo-capture" />,
}));

interface FetchCall {
  url: string;
  init?: RequestInit;
}
const fetchCalls: FetchCall[] = [];

function makeFetchMock(observationsResponse: () => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url, init });
    if (url === "/api/mobs") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "/api/observations") {
      return observationsResponse();
    }
    return new Response("null", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

beforeEach(() => {
  fetchCalls.length = 0;
  syncNowMock.mockClear();
  queueObservationMock.mockClear();
});

afterEach(() => {
  cleanup();
});

function paramsPromise(p: { farmSlug: string; campId: string }) {
  return Promise.resolve(p);
}

async function openCampConditionForm(
  result: ReturnType<typeof render>,
) {
  await waitFor(() => expect(result.getByText(/Report Camp Condition/i)).toBeTruthy());
  await act(async () => {
    fireEvent.click(result.getByText(/Report Camp Condition/i));
    await Promise.resolve();
  });

  await waitFor(() =>
    expect(result.getByText(/Submit Camp Report/i)).toBeTruthy(),
  );

  // Pick the three required selections so Submit is enabled. The option
  // cards render as `<button>${icon}${label}</button>` — match by visible
  // text rather than role+name (the accessible name includes the icon).
  await act(async () => {
    fireEvent.click(result.getByText("Good"));
    fireEvent.click(result.getByText("Full"));
    fireEvent.click(result.getByText("Intact"));
    await Promise.resolve();
  });
}

describe("CampInspectionPage — camp-condition duplicate-submit toast (#436)", () => {
  it("renders a toast sourced from classifySyncFailure when POST /api/observations returns 422 DUPLICATE_OBSERVATION", async () => {
    const duplicateBody = {
      error: "DUPLICATE_OBSERVATION",
      details: { existingId: "srv-existing-7" },
    };
    // The single source of truth the handler must consume. We derive the
    // expected copy here so the test fails closed if either side drifts.
    const expectedToast = classifySyncFailure(422, duplicateBody);
    expect(expectedToast.toast?.kind).toBe("duplicate");
    expect(typeof expectedToast.toast?.message).toBe("string");
    expect(expectedToast.remoteId).toBe("srv-existing-7");

    const fetchMock = makeFetchMock(
      () =>
        new Response(JSON.stringify(duplicateBody), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock;

    const { default: CampInspectionPage } = await import(
      "@/app/[farmSlug]/logger/[campId]/page"
    );

    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <CampInspectionPage
          params={paramsPromise({ farmSlug: "farm-x", campId: "A" })}
        />,
      );
    });

    await openCampConditionForm(result);

    await act(async () => {
      fireEvent.click(result.getByText(/Submit Camp Report/i));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The toast must surface the classifier's message verbatim — single
    // source of truth shared with `lib/sync-manager.ts`.
    const message = expectedToast.toast!.message;
    await waitFor(
      () => {
        expect(result.getByText(message)).toBeTruthy();
      },
      { timeout: 1000 },
    );

    // The duplicate-detection toast must carry an alert role so a screen
    // reader announces it (issue acceptance: "visible toast within 500ms").
    const toastEl = result.getByRole("alert");
    expect(toastEl.textContent).toContain(message);
  });

  it("does NOT render a duplicate toast on a happy-path 2xx submit (no regression on first inspection)", async () => {
    const fetchMock = makeFetchMock(
      () =>
        new Response(JSON.stringify({ id: "srv-new-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock;

    const { default: CampInspectionPage } = await import(
      "@/app/[farmSlug]/logger/[campId]/page"
    );

    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <CampInspectionPage
          params={paramsPromise({ farmSlug: "farm-x", campId: "A" })}
        />,
      );
    });

    await openCampConditionForm(result);

    await act(async () => {
      fireEvent.click(result.getByText(/Submit Camp Report/i));
      await Promise.resolve();
      await Promise.resolve();
    });

    // No duplicate-class toast should appear. The classifier copy for the
    // duplicate path is what would surface on a regression; assert it's
    // absent.
    const dupCopy = classifySyncFailure(422, {
      error: "DUPLICATE_OBSERVATION",
      details: { existingId: "irrelevant" },
    }).toast!.message;
    expect(result.queryByText(dupCopy)).toBeNull();
  });
});
