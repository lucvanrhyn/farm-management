// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceBadge } from "@/components/onboarding/ConfidenceBadge";

/**
 * Bands per spec:
 *   >= 0.85 -> "High"   (band: high / leaf-green)
 *   >= 0.5  -> "Review" (band: review / amber)
 *   <  0.5  -> "Manual" (band: manual / rust — pulses for attention)
 *
 * The redesign swapped stock Tailwind band colors for hand-mixed hex values
 * and exposes the band name via a `data-band` attribute. Tests assert on the
 * data-band contract + the visible text so future color tweaks don't break
 * the suite.
 */

describe("ConfidenceBadge", () => {
  it("renders High band for confidence 0.92", () => {
    render(<ConfidenceBadge confidence={0.92} />);
    const pill = screen.getByText(/92% · High/);
    expect(pill).toBeInTheDocument();
    expect(pill.getAttribute("data-band")).toBe("High");
  });

  it("renders Review band for confidence 0.71", () => {
    render(<ConfidenceBadge confidence={0.71} />);
    const pill = screen.getByText(/71% · Review/);
    expect(pill).toBeInTheDocument();
    expect(pill.getAttribute("data-band")).toBe("Review");
  });

  it("renders Manual band for confidence 0.34", () => {
    render(<ConfidenceBadge confidence={0.34} />);
    const pill = screen.getByText(/34% · Manual/);
    expect(pill).toBeInTheDocument();
    expect(pill.getAttribute("data-band")).toBe("Manual");
  });

  it("uses inclusive-on-lower thresholds: exactly 0.85 is High", () => {
    render(<ConfidenceBadge confidence={0.85} />);
    const pill = screen.getByText(/85% · High/);
    expect(pill.getAttribute("data-band")).toBe("High");
  });

  it("0.5 boundary is Review (not Manual)", () => {
    render(<ConfidenceBadge confidence={0.5} />);
    const pill = screen.getByText(/50% · Review/);
    expect(pill.getAttribute("data-band")).toBe("Review");
  });

  it("clamps percentage to [0, 100] on out-of-range inputs", () => {
    const { rerender } = render(<ConfidenceBadge confidence={-1} />);
    expect(screen.getByText(/0% · Manual/)).toBeInTheDocument();

    rerender(<ConfidenceBadge confidence={1.7} />);
    expect(screen.getByText(/100% · High/)).toBeInTheDocument();
  });
});
