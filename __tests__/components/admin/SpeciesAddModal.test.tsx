// @vitest-environment jsdom
/**
 * F1 — Species '+ Add' modal
 *
 * Tests SpeciesSettingsForm for:
 *  - Renders a "+ Add species" button
 *  - Clicking the button opens a modal
 *  - Modal contains "Import from CSV" and "Add manually" CTAs
 *  - Pressing Escape closes the modal
 *  - Clicking outside the modal (backdrop) closes it
 *
 * Auth is not required — these are pure component unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

// F1 requires a modal component — stub router for navigation CTAs
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/farm-x/admin/settings/species",
}));

import SpeciesSettingsForm, { type SpeciesRow } from "@/components/admin/SpeciesSettingsForm";

const SAMPLE_SPECIES: SpeciesRow[] = [
  { id: "cattle", label: "Cattle", icon: "Beef", enabled: true, required: true },
  { id: "sheep", label: "Sheep", icon: "Rabbit", enabled: false, required: false },
];

function renderForm(farmSlug = "farm-x", species = SAMPLE_SPECIES) {
  return render(<SpeciesSettingsForm farmSlug={farmSlug} species={species} />);
}

describe("F1 — SpeciesSettingsForm + Add modal", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a '+ Add species' button", () => {
    renderForm();
    const btn = screen.queryByRole("button", { name: /\+ Add species/i });
    expect(btn).not.toBeNull();
  });

  it("modal is NOT visible before the button is clicked", () => {
    renderForm();
    // modal should not be in the DOM or should have aria-hidden
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking '+ Add species' opens a modal dialog", () => {
    renderForm();
    const btn = screen.getByRole("button", { name: /\+ Add species/i });
    fireEvent.click(btn);
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("modal contains an 'Import from CSV' CTA", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /\+ Add species/i }));
    expect(screen.queryByText(/Import from CSV/i)).not.toBeNull();
  });

  it("modal contains an 'Add manually' CTA", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /\+ Add species/i }));
    expect(screen.queryByText(/Add manually/i)).not.toBeNull();
  });

  it("pressing Escape closes the modal", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /\+ Add species/i }));
    expect(screen.queryByRole("dialog")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking the backdrop closes the modal", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /\+ Add species/i }));
    expect(screen.queryByRole("dialog")).not.toBeNull();

    // Backdrop should have data-testid="modal-backdrop"
    const backdrop = screen.queryByTestId("modal-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking inside the modal does NOT close it", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /\+ Add species/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    // modal should still be open
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});
