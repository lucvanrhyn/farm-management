// @vitest-environment jsdom
/**
 * wave/27a-copy — copy-only batch covering issue #27 items S1, O2, O3.
 *
 *  S1: SettingsForm "Stale Inspection Alert" label rewritten so the meaning
 *      of the number-of-hours field is unambiguous (with an example).
 *  O2: NoPedigreeEmptyState on the Breeding AI page now explains *why*
 *      pedigree data matters (COI/EBV) and links to a downloadable example
 *      pedigree CSV at /sample-pedigree.csv.
 *  O3: AnimalImporter shows a dismissible "we will ask you about
 *      ambiguities" stub that previews the AI Grill Wizard flow shipping
 *      in #30. Dismissal sticks via localStorage.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

import SettingsForm, {
  type FarmSettingsData,
} from "@/components/admin/SettingsForm";
import NoPedigreeEmptyState from "@/components/admin/breeding/NoPedigreeEmptyState";
import AnimalImporter from "@/components/admin/AnimalImporter";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/farm-x/admin/import",
}));

const BASE_SETTINGS: FarmSettingsData = {
  farmName: "Acme",
  breed: "Brangus",
  alertThresholdHours: 48,
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  targetStockingRate: null,
  latitude: null,
  longitude: null,
  breedingSeasonStart: "10-01",
  breedingSeasonEnd: "12-31",
  weaningDate: "06-01",
  defaultRestDays: 60,
  defaultMaxGrazingDays: 7,
  rotationSeasonMode: "auto",
  dormantSeasonMultiplier: 1.5,
  openaiApiKeyConfigured: false,
  biomeType: null,
  ownerName: "",
  ownerIdNumber: "",
  taxReferenceNumber: "",
  physicalAddress: "",
  postalAddress: "",
  contactPhone: "",
  contactEmail: "",
  propertyRegNumber: "",
  farmRegion: "",
};

beforeEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* noop */
  }
});

describe("S1 — SettingsForm: Stale Inspection Alert label is self-evident", () => {
  it("renders an unambiguous label that names the unit and gives an example", () => {
    render(<SettingsForm farmSlug="farm-x" initial={BASE_SETTINGS} />);

    // The new label must spell out the action ("Alert if camp not inspected")
    // and the unit ("hours"), matching what the threshold actually controls.
    expect(
      screen.getByText(/Alert if a camp has not been inspected for/i),
    ).toBeInTheDocument();

    // It must include a concrete example so the farmer knows what 48 means.
    expect(screen.getByText(/e\.g\. 48 = 2 days/i)).toBeInTheDocument();
  });
});

describe("O2 — NoPedigreeEmptyState: pedigree explainer + sample CSV link", () => {
  it("explains why we need pedigree data (COI / EBV / 10 % threshold)", () => {
    render(<NoPedigreeEmptyState farmSlug="farm-x" />);

    expect(screen.getByText(/inbreeding coefficient/i)).toBeInTheDocument();
    expect(screen.getByText(/EBV/)).toBeInTheDocument();
    expect(screen.getByText(/10\s*%/)).toBeInTheDocument();
  });

  it("links to the downloadable sample pedigree CSV", () => {
    render(<NoPedigreeEmptyState farmSlug="farm-x" />);
    const link = screen.getByRole("link", {
      name: /sample pedigree csv/i,
    }) as HTMLAnchorElement;
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/sample-pedigree.csv");
  });

  it("retains the existing 'Import pedigree data' CTA so users can still launch the wizard", () => {
    render(<NoPedigreeEmptyState farmSlug="farm-x" />);
    const cta = screen.getByRole("link", { name: /import pedigree data/i });
    expect(cta.getAttribute("href")).toBe(
      "/farm-x/admin/import?template=pedigree",
    );
  });
});

describe("O3 — AnimalImporter: AI Grill Wizard messaging stub", () => {
  it("renders the disambiguation messaging stub by default", () => {
    render(<AnimalImporter />);
    expect(
      screen.getByText(/we'?ll pause and ask you about each one/i),
    ).toBeInTheDocument();
    // Marked as upcoming — copy must say "Coming soon" so users know it's a preview
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("hides the stub when localStorage flag is already set", () => {
    window.localStorage.setItem("seen:import-disambig-stub", "1");
    render(<AnimalImporter />);
    expect(
      screen.queryByText(/we'?ll pause and ask you about each one/i),
    ).not.toBeInTheDocument();
  });

  it("dismisses the stub when the user clicks 'Got it' and persists to localStorage", () => {
    render(<AnimalImporter />);
    const dismiss = screen.getByRole("button", { name: /got it/i });
    fireEvent.click(dismiss);

    expect(
      screen.queryByText(/we'?ll pause and ask you about each one/i),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem("seen:import-disambig-stub")).toBe("1");
  });
});
