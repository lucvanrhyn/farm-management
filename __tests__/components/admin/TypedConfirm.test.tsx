// @vitest-environment jsdom
/**
 * #371 — Typed confirmation gate for destructive bulk actions.
 *
 * `TypedConfirm` is the shared primitive extracted so all three destructive
 * bulk-action call sites (DangerZone "RESET", ClearSectionButton, and the
 * camps "Remove All Camps") use ONE consistent confirmation pattern instead
 * of three bespoke ones (bare native confirm / weak two-step tap).
 *
 * Contract under test:
 *   1. The destructive action does NOT fire from the initial trigger click —
 *      clicking the trigger only reveals the typed-confirmation input.
 *   2. Once revealed, the confirm button stays disabled (and the action
 *      stays blocked) until the EXACT phrase is typed.
 *   3. A near-miss / wrong-case phrase keeps the action blocked.
 *   4. Typing the exact phrase enables confirm; clicking it fires onConfirm.
 *   5. Cancel resets back to the trigger without firing onConfirm.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

import TypedConfirm from "@/components/admin/TypedConfirm";

function typeInto(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

describe("#371 — TypedConfirm shared typed-confirmation primitive", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it("does NOT fire onConfirm when the trigger is clicked — only reveals the input", () => {
    const onConfirm = vi.fn();
    render(
      <TypedConfirm
        phrase="RESET"
        triggerLabel="Remove All Data"
        confirmLabel="Confirm Reset"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove All Data" }));
    expect(onConfirm).not.toHaveBeenCalled();
    // The typed-confirmation input is now visible.
    expect(screen.getByPlaceholderText(/RESET/)).toBeInTheDocument();
  });

  it("keeps the confirm action blocked until the exact phrase is typed", () => {
    const onConfirm = vi.fn();
    render(
      <TypedConfirm
        phrase="RESET"
        triggerLabel="Remove All Data"
        confirmLabel="Confirm Reset"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove All Data" }));
    const confirmBtn = screen.getByRole("button", { name: "Confirm Reset" });
    const input = screen.getByPlaceholderText(/RESET/);

    // Empty → blocked.
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();

    // Partial phrase → still blocked.
    typeInto(input, "RESE");
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();

    // Wrong case → still blocked (must match exactly).
    typeInto(input, "reset");
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();

    // Trailing whitespace → still blocked (exact match).
    typeInto(input, "RESET ");
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fires onConfirm only after the exact phrase is typed", () => {
    const onConfirm = vi.fn();
    render(
      <TypedConfirm
        phrase="REMOVE"
        triggerLabel="Remove All Camps"
        confirmLabel="Confirm Remove"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove All Camps" }));
    const confirmBtn = screen.getByRole("button", { name: "Confirm Remove" });
    typeInto(screen.getByPlaceholderText(/REMOVE/), "REMOVE");
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancel returns to the trigger without firing onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <TypedConfirm
        phrase="CLEAR"
        triggerLabel="Clear All Animals"
        confirmLabel="Yes, clear"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear All Animals" }));
    typeInto(screen.getByPlaceholderText(/CLEAR/), "CLEAR");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    // Back to the trigger; the input is gone.
    expect(screen.getByRole("button", { name: "Clear All Animals" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/CLEAR/)).toBeNull();
  });
});
