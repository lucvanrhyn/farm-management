// @vitest-environment jsdom
/**
 * #263 — SpeciesSettingsForm: explicit "Multi-species rollout — contact us"
 * copy replaces the previous F1 "+ Add species" CTA + dummy modal.
 *
 * Background. The original F1 modal (PR shipped as wave/235) opened a
 * dialog with two CTAs that just routed to /admin/import and
 * /admin/animals — neither of which actually added a species. The user
 * explicitly flagged this as dead UI on 2026-05-13: "I don't like that
 * add species thing that's everywhere... it needs to be removed."
 *
 * After #263 the form must:
 *   1. NOT render the "+ Add species" button.
 *   2. NOT mount the AddSpeciesModal under any circumstance.
 *   3. Render explicit copy referencing the multi-species rollout +
 *      a contact affordance (mailto / link / button — wording flexible).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

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

describe("#263 — SpeciesSettingsForm contact-us copy (supersedes F1 modal)", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it("does NOT render the '+ Add species' button", () => {
    renderForm();
    const btn = screen.queryByRole("button", { name: /\+\s*Add species/i });
    expect(btn).toBeNull();
  });

  it("does NOT mount the AddSpeciesModal (no role=dialog in initial render)", () => {
    renderForm();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders explicit 'Multi-species rollout' copy", () => {
    renderForm();
    expect(screen.queryByText(/multi-species rollout/i)).not.toBeNull();
  });

  it("renders a contact affordance (mailto link or contact button)", () => {
    renderForm();
    // Either a "Contact us" button/link or a mailto: anchor — wording flexible.
    const link = screen.queryByRole("link", { name: /contact/i });
    const button = screen.queryByRole("button", { name: /contact/i });
    expect(link ?? button).not.toBeNull();
  });

  it("still renders existing species toggles (Cattle, Sheep)", () => {
    renderForm();
    // Sanity: the toggles are the actual functional UI on this page.
    expect(screen.queryByText(/^Cattle$/)).not.toBeNull();
    expect(screen.queryByText(/^Sheep$/)).not.toBeNull();
  });
});
