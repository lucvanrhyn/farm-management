// @vitest-environment jsdom
/**
 * Issue #496 — the sheep observations timeline must consume the now
 * species-aware `/api/observations?species=sheep` endpoint instead of the
 * SSR facade it received pre-#491 (when the API was species-blind and the
 * page hand-fed a `scoped(prisma, "sheep")` server query).
 *
 * Pinning the request wiring: on mount the timeline fetches
 * `/api/observations` carrying `species=sheep`, then renders the returned
 * rows. The route IS the species axis (ADR-0003) so the param is the literal
 * "sheep" regardless of the farm-mode cookie.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

import SheepObservationsTimeline from "../SheepObservationsTimeline";

function observationUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/api/observations"));
}

const ROW = {
  id: "obs-1",
  type: "note",
  campId: "C1",
  animalId: null,
  details: "{}",
  observedAt: "2026-05-01T00:00:00.000Z",
  loggedBy: "shepherd",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SheepObservationsTimeline — consumes species-aware API (#496)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("fetches /api/observations?species=sheep on mount", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [ROW] });
    vi.stubGlobal("fetch", fetchMock);

    render(<SheepObservationsTimeline />);

    await waitFor(() => {
      expect(observationUrls(fetchMock).length).toBeGreaterThanOrEqual(1);
    });
    const obsUrls = observationUrls(fetchMock);
    expect(obsUrls.every((u) => u.includes("species=sheep"))).toBe(true);
  });

  it("renders the rows returned by the species-aware API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [ROW] });
    vi.stubGlobal("fetch", fetchMock);

    render(<SheepObservationsTimeline />);

    await waitFor(() => {
      expect(screen.getByTestId("sheep-observations-timeline")).toBeInTheDocument();
    });
    expect(screen.getAllByTestId("sheep-observation-row").length).toBe(1);
  });

  it("shows the empty state when the API returns no sheep rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    render(<SheepObservationsTimeline />);

    await waitFor(() => {
      expect(screen.getByText(/No sheep observations yet/i)).toBeInTheDocument();
    });
  });
});
