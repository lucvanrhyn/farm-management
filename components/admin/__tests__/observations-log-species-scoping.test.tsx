// @vitest-environment jsdom
/**
 * Issue #496 — thread the active species through the admin observations
 * timeline so a mixed-species tenant only sees the active species' rows.
 *
 * #491 made `GET /api/observations` accept an OPT-IN `?species=<x>` param:
 *   - omitted  → cross-species rollup (the #356 invariant)
 *   - present  → narrow to species X
 *
 * The API-only fix is necessary but not sufficient: `ObservationsLog` never
 * requested it, so a mixed-species admin timeline still listed ALL species'
 * rows. This test pins the request wiring:
 *
 *   - multi-species tenant + active species → fetch carries `?species=<active>`
 *   - single-species tenant ("all" / no narrowing) → fetch OMITS `?species`
 *     (cross-species default preserved, no behaviour change).
 *
 * The "active species" is the SSR-resolved farm mode threaded in as the
 * `species` prop (same source the create-modal + AnimalsTable already use,
 * `getFarmMode(farmSlug)` in the page server component). Whether to narrow
 * is gated on `useFarmModeSafe().isMultiMode` so a single-species tenant
 * never narrows (its sole species == the cross-species set).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

// Mutable farm-mode signal the component reads via useFarmModeSafe().
const farmModeState = { isMultiMode: false, mode: "cattle" as string };
vi.mock("@/lib/farm-mode", () => ({
  useFarmModeSafe: () => farmModeState,
}));

// Stub the heavy child surfaces so we only exercise the fetch wiring.
vi.mock("@/components/admin/observations-log/EditModal", () => ({
  EditModal: () => null,
}));
vi.mock("@/components/admin/observations-log/Filters", () => ({
  Filters: () => null,
}));
vi.mock("@/components/admin/observations-log/ObservationRow", () => ({
  ObservationRow: () => null,
}));
vi.mock("@/components/admin/observations-log/Pagination", () => ({
  Pagination: () => null,
}));

import ObservationsLog from "../ObservationsLog";

function observationUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/api/observations"));
}

beforeEach(() => {
  farmModeState.isMultiMode = false;
  farmModeState.mode = "cattle";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ObservationsLog — active-species scoping (#496)", () => {
  it("requests ?species=<active> on a multi-species tenant", async () => {
    farmModeState.isMultiMode = true;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    render(<ObservationsLog species="sheep" />);

    await waitFor(() => {
      expect(observationUrls(fetchMock).length).toBeGreaterThanOrEqual(1);
    });
    const obsUrls = observationUrls(fetchMock);
    expect(obsUrls.every((u) => u.includes("species=sheep"))).toBe(true);
  });

  it("OMITS ?species on a single-species tenant (cross-species default)", async () => {
    farmModeState.isMultiMode = false;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    render(<ObservationsLog species="cattle" />);

    await waitFor(() => {
      expect(observationUrls(fetchMock).length).toBeGreaterThanOrEqual(1);
    });
    const obsUrls = observationUrls(fetchMock);
    expect(obsUrls.some((u) => u.includes("species="))).toBe(false);
  });

  it("OMITS ?species when no active species is supplied even on a multi tenant", async () => {
    farmModeState.isMultiMode = true;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    // species prop absent (e.g. an unknown / "all" mode) → no narrowing.
    render(<ObservationsLog />);

    await waitFor(() => {
      expect(observationUrls(fetchMock).length).toBeGreaterThanOrEqual(1);
    });
    const obsUrls = observationUrls(fetchMock);
    expect(obsUrls.some((u) => u.includes("species="))).toBe(false);
  });
});
