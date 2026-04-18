// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceBadge } from "@/components/onboarding/ConfidenceBadge";

/**
 * Bands per spec:
 *   >= 0.85 -> green "High"
 *   >= 0.5  -> yellow "Review"
 *   < 0.5   -> red "Manual"
 *
 * We assert both label text + percentage + band-specific background class.
 */

describe("ConfidenceBadge", () => {
  it("renders green High band for confidence 0.92", () => {
    render(<ConfidenceBadge confidence={0.92} />);
    const pill = screen.getByText(/92% · High/);
    expect(pill).toBeInTheDocument();
    expect(pill.className).toMatch(/bg-green-700/);
    expect(pill.className).toMatch(/text-white/);
  });

  it("renders yellow Review band for confidence 0.71", () => {
    render(<ConfidenceBadge confidence={0.71} />);
    const pill = screen.getByText(/71% · Review/);
    expect(pill).toBeInTheDocument();
    expect(pill.className).toMatch(/bg-yellow-500/);
  });

  it("renders red Manual band for confidence 0.34", () => {
    render(<ConfidenceBadge confidence={0.34} />);
    const pill = screen.getByText(/34% · Manual/);
    expect(pill).toBeInTheDocument();
    expect(pill.className).toMatch(/bg-red-600/);
  });

  it("uses inclusive-on-lower thresholds: exactly 0.85 is green", () => {
    render(<ConfidenceBadge confidence={0.85} />);
    const pill = screen.getByText(/85% · High/);
    expect(pill.className).toMatch(/bg-green-700/);
  });

  it("0.5 boundary is yellow (Review), not red", () => {
    render(<ConfidenceBadge confidence={0.5} />);
    const pill = screen.getByText(/50% · Review/);
    expect(pill.className).toMatch(/bg-yellow-500/);
  });

  it("clamps percentage to [0, 100] on out-of-range inputs", () => {
    const { rerender } = render(<ConfidenceBadge confidence={-1} />);
    expect(screen.getByText(/0% · Manual/)).toBeInTheDocument();

    rerender(<ConfidenceBadge confidence={1.7} />);
    expect(screen.getByText(/100% · High/)).toBeInTheDocument();
  });
});
