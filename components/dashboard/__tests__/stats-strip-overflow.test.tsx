// @vitest-environment jsdom
/**
 * Issue #467 — Mobile dashboard KPI strip must not silently clip.
 *
 * Root cause (verified live at 390px on prod): the chip strip lives inside a
 * single non-wrapping flex top bar whose other children are `flexShrink: 0`
 * (logotype, weather widget, controls). The strip has `flex: 1` so it *can*
 * grow, but with no `minWidth: 0` its min-content width (chips are
 * `whiteSpace: nowrap`) pins it open, and with no overflow affordance the
 * overflow is *clipped* off the right edge rather than scrollable — the
 * rightmost "Active Alerts" chip disappears with no way to reach it.
 *
 * The structural fix is purely presentational and keeps the desktop layout
 * identical (when the chips fit, an `overflow-x: auto` container shows no
 * scrollbar and `justify-content: center` still centers):
 *
 *   1. The strip container must allow itself to shrink below its content
 *      width inside the flex row (`minWidth: 0`) so it receives a constrained
 *      width instead of pushing the `flexShrink: 0` siblings off-screen.
 *   2. The strip container must turn that constrained overflow into an
 *      *intentional* horizontal scroll region (`overflowX: auto`) rather than
 *      letting the parent clip it silently.
 *   3. The chips themselves must not be squeezed (`flexShrink: 0`) — a
 *      readable "Active Alerts" chip beats four crushed unreadable ones.
 *
 * These three style invariants are what the live Playwright spec
 * (`e2e/dashboard-mobile-kpi.spec.ts`) proves at 390px against a real DOM;
 * this unit test locks them at the component-contract layer so the fix can be
 * driven and regression-guarded without a live authenticated server.
 *
 * The multi-species (dual-chip) branch is exercised too so the cross-species
 * `Total` chip is covered by the same no-clip guarantees.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import DashboardStatsStrip from "../DashboardStatsStrip";

afterEach(() => cleanup());

/** The strip is the outermost element rendered by DashboardStatsStrip. */
function renderStrip(extra?: { crossSpeciesTotal?: number; modeLabel?: string }) {
  const { container } = render(
    <DashboardStatsStrip
      totalAnimals={88}
      inspectedLabel="3/9"
      alertLabel={2}
      alertAccent
      alertPulse
      crossSpeciesTotal={extra?.crossSpeciesTotal}
      modeLabel={extra?.modeLabel}
    />,
  );
  const strip = container.firstElementChild as HTMLElement;
  expect(strip, "strip container must render").not.toBeNull();
  return strip;
}

describe("DashboardStatsStrip — #467 no-clip overflow contract", () => {
  it("strip can shrink below its content width inside the flex top bar (minWidth: 0)", () => {
    const strip = renderStrip();
    expect(
      strip.style.minWidth,
      "strip must set minWidth:0 so it shrinks below its chips' min-content width instead of pushing the flexShrink:0 siblings (weather/controls) off-screen",
    ).toBe("0px");
  });

  it("strip turns overflow into an intentional horizontal scroll region (overflowX: auto)", () => {
    const strip = renderStrip();
    expect(
      strip.style.overflowX,
      "strip must scroll its overflow rather than letting the parent silently clip the rightmost (Active Alerts) chip",
    ).toBe("auto");
  });

  it("chips are not squeezed by the flex row (flexShrink: 0 on each chip)", () => {
    const strip = renderStrip();
    const chips = Array.from(strip.children) as HTMLElement[];
    // Single-species: Total Animals, Inspected, Active Alerts.
    expect(chips.length).toBe(3);
    for (const chip of chips) {
      expect(
        chip.style.flexShrink,
        "each chip must keep its intrinsic width (flexShrink:0) so the labels stay readable when scrolling",
      ).toBe("0");
    }
  });

  it("preserves the centered desktop layout primitives (flex row, centered)", () => {
    const strip = renderStrip();
    expect(strip.style.display).toBe("flex");
    expect(strip.style.justifyContent).toBe("center");
  });

  it("multi-species dual-chip layout keeps the same no-clip guarantees", () => {
    const strip = renderStrip({ crossSpeciesTotal: 142, modeLabel: "Cattle" });
    expect(strip.style.minWidth).toBe("0px");
    expect(strip.style.overflowX).toBe("auto");
    const chips = Array.from(strip.children) as HTMLElement[];
    // Multi-species: Cattle (mode), Total (cross-species), Inspected, Active Alerts.
    expect(chips.length).toBe(4);
    for (const chip of chips) {
      expect(chip.style.flexShrink).toBe("0");
    }
  });
});
