/**
 * @vitest-environment jsdom
 *
 * Wave A3 — Codex audit 2026-05-10 follow-up to C2 (cross-surface count
 * divergence). Wave A2 (#187) closed the STRUCTURAL divergence by aligning
 * every per-species surface on the same Active-status + species filter via
 * `lib/animals/active-species-filter.ts`. The remaining product gap (Luc,
 * 2026-05-11): when a farm has multiple species, the dashboard header
 * currently shows ONLY the mode-filtered count (e.g. "88 Cattle"), so the
 * cross-species total ("101 Total") is invisible from the headline view.
 * Users on multi-species farms need both numbers simultaneously to trust
 * the per-species view isn't hiding anything.
 *
 * Contract this test enforces:
 *   - On a multi-species farm (`enabledSpecies` length > 1) the strip
 *     renders TWO chips: the mode-filtered count labelled by mode (e.g.
 *     "Cattle"), and the cross-species total labelled "Total".
 *   - On a single-species farm (`enabledSpecies` length === 1) the strip
 *     keeps the existing single-chip layout — no regression for the
 *     cattle-only / sheep-only / game-only tenants that make up the
 *     majority of the install base.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { FarmModeProvider } from "@/lib/farm-mode";
import DashboardStatsStrip from "@/components/dashboard/DashboardStatsStrip";

afterEach(() => {
  cleanup();
});

describe("DashboardStatsStrip — dual-count chips (Wave A3 / C2)", () => {
  it("renders BOTH the mode-filtered chip and a cross-species Total chip on a multi-species farm", () => {
    render(
      <FarmModeProvider farmSlug="test-farm" enabledSpecies={["cattle", "sheep"]}>
        <DashboardStatsStrip
          totalAnimals={88}
          inspectedLabel="3/9"
          alertLabel={0}
          alertAccent={false}
          alertPulse={false}
          crossSpeciesTotal={101}
          modeLabel="Cattle"
        />
      </FarmModeProvider>,
    );

    // Mode-filtered chip — value + mode label
    expect(screen.getByText("88")).toBeTruthy();
    expect(screen.getByText("Cattle")).toBeTruthy();

    // Cross-species total chip — value + "Total" label
    expect(screen.getByText("101")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
  });

  it("renders only the single mode-filtered chip on a single-species farm (no visual regression)", () => {
    render(
      <FarmModeProvider farmSlug="test-farm" enabledSpecies={["cattle"]}>
        <DashboardStatsStrip
          totalAnimals={88}
          inspectedLabel="3/9"
          alertLabel={0}
          alertAccent={false}
          alertPulse={false}
          // Caller intentionally omits crossSpeciesTotal/modeLabel when
          // `isMultiMode` is false — see DashboardClient.tsx.
        />
      </FarmModeProvider>,
    );

    expect(screen.getByText("88")).toBeTruthy();
    // No second chip — no "Total" label, no orphaned mode label.
    expect(screen.queryByText("Total")).toBeNull();
    expect(screen.queryByText("Cattle")).toBeNull();
  });

  it("does not duplicate the chip when crossSpeciesTotal equals the mode-filtered count (e.g. all 101 animals are cattle)", () => {
    // If a multi-species farm happens to have 0 sheep right now, the two
    // numbers are identical. Showing two identical chips is noise, so the
    // strip should fall back to single-chip in that case.
    render(
      <FarmModeProvider farmSlug="test-farm" enabledSpecies={["cattle", "sheep"]}>
        <DashboardStatsStrip
          totalAnimals={101}
          inspectedLabel="3/9"
          alertLabel={0}
          alertAccent={false}
          alertPulse={false}
          crossSpeciesTotal={101}
          modeLabel="Cattle"
        />
      </FarmModeProvider>,
    );

    expect(screen.getAllByText("101")).toHaveLength(1);
    expect(screen.queryByText("Total")).toBeNull();
  });
});
