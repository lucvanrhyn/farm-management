// @vitest-environment jsdom
/**
 * #371 — ClearSectionButton typed-confirmation gate.
 *
 * The per-section clears (Clear All Animals / Observations / Transactions /
 * Sheep) previously used a weak two-step tap ("Are you sure?" → "Yes, clear").
 * #371 upgrades them to the shared typed-confirmation pattern: the DELETE
 * request must NOT fire until the user types the confirmation phrase exactly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import ClearSectionButton from "@/components/admin/ClearSectionButton";

function typeInto(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

describe("#371 — ClearSectionButton typed confirmation", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it("does NOT fire the DELETE request from the initial trigger click", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ClearSectionButton endpoint="/api/animals/reset" label="Clear All Animals" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear All Animals" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the clear action blocked until the exact phrase is typed", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ClearSectionButton endpoint="/api/animals/reset" label="Clear All Animals" />);

    fireEvent.click(screen.getByRole("button", { name: "Clear All Animals" }));
    const confirmBtn = screen.getByRole("button", { name: /yes, clear/i });
    const input = screen.getByPlaceholderText(/CLEAR/);

    // Empty / partial / wrong-case → blocked.
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    typeInto(input, "CLEA");
    fireEvent.click(confirmBtn);
    typeInto(input, "clear");
    fireEvent.click(confirmBtn);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fires the DELETE request only after the exact phrase is typed", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ClearSectionButton endpoint="/api/animals/reset" label="Clear All Animals" />);

    fireEvent.click(screen.getByRole("button", { name: "Clear All Animals" }));
    typeInto(screen.getByPlaceholderText(/CLEAR/), "CLEAR");
    fireEvent.click(screen.getByRole("button", { name: /yes, clear/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/animals/reset", { method: "DELETE" });
  });
});
