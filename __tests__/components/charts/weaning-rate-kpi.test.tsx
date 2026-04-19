// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import WeaningRateKPI, { weaningBand } from "@/components/admin/charts/WeaningRateKPI";

vi.mock("recharts", async () => {
  const actual = (await vi.importActual("recharts")) as Record<string, unknown>;
  const React = (await vi.importActual("react")) as typeof import("react");
  type ChartProps = { width?: number; height?: number };
  const ResponsiveContainer = ({ children }: { children: React.ReactElement<ChartProps> }) => (
    <div data-testid="sparkline">
      {React.cloneElement(children, { width: 200, height: 40 })}
    </div>
  );
  return { ...actual, ResponsiveContainer };
});

describe("WeaningRateKPI", () => {
  beforeEach(() => cleanup());

  it("weaningBand classifies values around the 88/80 thresholds", () => {
    expect(weaningBand(null, 88)).toBe("gray");
    expect(weaningBand(90, 88)).toBe("green");
    expect(weaningBand(88, 88)).toBe("green");
    expect(weaningBand(85, 88)).toBe("amber");
    expect(weaningBand(80, 88)).toBe("amber");
    expect(weaningBand(79, 88)).toBe("red");
    expect(weaningBand(50, 88)).toBe("red");
  });

  it("renders the current percentage and the Target ≥88% caption", () => {
    render(<WeaningRateKPI weaningRate={90} history={[]} />);
    expect(screen.getByText("90%")).toBeTruthy();
    expect(screen.getByText(/Target ≥88%/)).toBeTruthy();
  });

  it("shows em-dash when the rate is null", () => {
    render(<WeaningRateKPI weaningRate={null} history={[]} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("does NOT render a sparkline when history is empty", () => {
    render(<WeaningRateKPI weaningRate={90} history={[]} />);
    expect(screen.queryByTestId("sparkline")).toBeNull();
    expect(screen.getByText(/Track weaning across years/i)).toBeTruthy();
  });

  it("renders a sparkline when history has points", () => {
    const history = [
      { year: 2023, rate: 82 },
      { year: 2024, rate: 86 },
      { year: 2025, rate: 90 },
    ];
    render(<WeaningRateKPI weaningRate={90} history={history} />);
    expect(screen.getByTestId("sparkline")).toBeTruthy();
  });
});
