// @vitest-environment jsdom
/**
 * #371 — "Remove All Camps" typed-confirmation gate.
 *
 * "Remove All Camps" previously sat inline with everyday table controls
 * (next to "+ Add Camp") and fired a bare native `window.confirm()`.
 * #371 moves it into a clearly marked Danger Zone and replaces the native
 * confirm with the shared typed-confirmation pattern.
 *
 * Asserted:
 *   1. No bare `window.confirm()` is invoked for the bulk remove.
 *   2. The trigger lives inside a `data-testid="danger-zone"` wrapper.
 *   3. The DELETE request stays blocked until the exact phrase is typed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import CampsTableClient, { type CampRow } from "@/components/admin/CampsTableClient";

function typeInto(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

const ROWS: CampRow[] = [
  {
    camp_id: "C1",
    camp_name: "North Camp",
    liveCount: 0,
    grazing: "Good",
    fence: "Intact",
    lastDate: "—",
    lastBy: "—",
    veldType: null,
    restDaysOverride: null,
    maxGrazingDaysOverride: null,
    rotationNotes: null,
  },
];

describe("#371 — CampsTableClient 'Remove All Camps' typed confirmation", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it("places 'Remove All Camps' inside a Danger Zone, not inline with table controls", () => {
    render(<CampsTableClient rows={ROWS} farmSlug="farm-x" />);
    const trigger = screen.getByRole("button", { name: "Remove All Camps" });
    const dangerZone = screen.getByTestId("danger-zone");
    expect(dangerZone.contains(trigger)).toBe(true);
  });

  it("uses a typed confirmation, never a bare native window.confirm()", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CampsTableClient rows={ROWS} farmSlug="farm-x" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove All Camps" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    // The trigger only reveals the typed input — no request yet.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/REMOVE/)).toBeInTheDocument();
  });

  it("keeps the remove request blocked until the exact phrase is typed", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CampsTableClient rows={ROWS} farmSlug="farm-x" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove All Camps" }));
    const confirmBtn = screen.getByRole("button", { name: /confirm remove/i });
    const input = screen.getByPlaceholderText(/REMOVE/);

    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    typeInto(input, "REMOV");
    fireEvent.click(confirmBtn);
    typeInto(input, "remove");
    fireEvent.click(confirmBtn);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fires the DELETE /api/camps/reset request only after the exact phrase is typed", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CampsTableClient rows={ROWS} farmSlug="farm-x" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove All Camps" }));
    typeInto(screen.getByPlaceholderText(/REMOVE/), "REMOVE");
    fireEvent.click(screen.getByRole("button", { name: /confirm remove/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/camps/reset", { method: "DELETE" });
  });
});
