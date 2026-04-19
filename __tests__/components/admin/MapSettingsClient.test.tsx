// @vitest-environment jsdom
/**
 * Tests for components/admin/map/MapSettingsClient.tsx (Phase K Wave 3F).
 *
 * Coverage:
 *  - Basic tier: moat-layer toggles (AFIS, FMD, Eskom, MTN) rendered disabled
 *    with an "Advanced" badge and an Upgrade link.
 *  - Advanced tier: same moat-layer toggles rendered enabled.
 *  - Non-moat toggles always enabled regardless of tier.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import MapSettingsClient, {
  type FmdZoneResult,
} from "@/components/admin/map/MapSettingsClient";

const INITIAL_SETTINGS = { eskomAreaId: null };
const FMD_UNKNOWN: FmdZoneResult = { status: "unknown" };

describe("MapSettingsClient — Layers tab moat gating", () => {
  beforeEach(() => {
    cleanup();
    try {
      window.localStorage.removeItem("farmtrack.map.layers");
    } catch {
      // noop
    }
  });

  it("disables moat toggles for basic-tier users", () => {
    render(
      <MapSettingsClient
        farmSlug="farm-x"
        tier="basic"
        initialSettings={INITIAL_SETTINGS}
        fmdZone={FMD_UNKNOWN}
      />,
    );

    // The 4 moat layer keys (same as LayerToggle)
    const moats = ["afisFire", "fmdZones", "eskomBanner", "mtnCoverage"];
    for (const key of moats) {
      const input = document.getElementById(`layer-${key}`) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.disabled).toBe(true);
    }

    // Each moat row should display the "Advanced" badge.
    const badges = screen.getAllByText("Advanced");
    expect(badges.length).toBe(moats.length);

    // Each moat row should include an "Upgrade" link.
    const upgradeLinks = screen.getAllByRole("link", { name: /upgrade/i });
    expect(upgradeLinks.length).toBeGreaterThanOrEqual(moats.length);
  });

  it("enables moat toggles for advanced-tier users", () => {
    render(
      <MapSettingsClient
        farmSlug="farm-x"
        tier="advanced"
        initialSettings={INITIAL_SETTINGS}
        fmdZone={FMD_UNKNOWN}
      />,
    );

    const moats = ["afisFire", "fmdZones", "eskomBanner", "mtnCoverage"];
    for (const key of moats) {
      const input = document.getElementById(`layer-${key}`) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.disabled).toBe(false);
    }

    // No Upgrade links should render on the Layers tab for advanced-tier.
    const upgradeLinks = screen.queryAllByRole("link", { name: /upgrade/i });
    expect(upgradeLinks.length).toBe(0);
  });

  it("always enables non-moat toggles regardless of tier", () => {
    render(
      <MapSettingsClient
        farmSlug="farm-x"
        tier="basic"
        initialSettings={INITIAL_SETTINGS}
        fmdZone={FMD_UNKNOWN}
      />,
    );

    const freeLayers = [
      "campOverlay",
      "taskPins",
      "waterPoints",
      "infrastructure",
      "rainfallGauges",
    ];
    for (const key of freeLayers) {
      const input = document.getElementById(`layer-${key}`) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.disabled).toBe(false);
    }
  });
});
