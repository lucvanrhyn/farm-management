// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import WeightTrendChart, {
  adgColor,
  fitLinear,
  type WeightPoint,
} from "@/components/admin/charts/WeightTrendChart";

vi.mock("recharts", async () => {
  const actual = (await vi.importActual("recharts")) as Record<string, unknown>;
  const React = (await vi.importActual("react")) as typeof import("react");
  type ChartProps = { width?: number; height?: number };
  const ResponsiveContainer = ({ children }: { children: React.ReactElement<ChartProps> }) =>
    React.cloneElement(children, { width: 800, height: 220 });
  return { ...actual, ResponsiveContainer };
});

describe("WeightTrendChart — helpers", () => {
  it("adgColor returns green for ADG at/above target, amber for ≥0.7, red below", () => {
    expect(adgColor(1.0, 0.9)).toBe("#10b981"); // good
    expect(adgColor(0.9, 0.9)).toBe("#10b981"); // boundary → good
    expect(adgColor(0.8, 0.9)).toBe("#f59e0b"); // ok
    expect(adgColor(0.7, 0.9)).toBe("#f59e0b"); // boundary → ok
    expect(adgColor(0.5, 0.9)).toBe("#ef4444"); // poor
    // Null ADG falls back to the legacy default colour so existing callers are unaffected.
    expect(adgColor(null, 0.9)).toBe("#4A7C59");
  });

  it("fitLinear recovers the slope and intercept of a clean line", () => {
    // y = 2x + 300 (ideal 2 kg/day gain, starting at 300 kg)
    const points: WeightPoint[] = [
      { date: "d0", weight: 300, trend: null, dayIndex: 0 },
      { date: "d10", weight: 320, trend: null, dayIndex: 10 },
      { date: "d20", weight: 340, trend: null, dayIndex: 20 },
    ];
    const fit = fitLinear(points);
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBeCloseTo(2, 5);
    expect(fit!.intercept).toBeCloseTo(300, 5);
    expect(fit!.r2).toBeCloseTo(1, 5);
  });

  it("fitLinear returns null when fewer than two actuals are provided", () => {
    const points: WeightPoint[] = [
      { date: "d0", weight: 300, trend: null, dayIndex: 0 },
    ];
    expect(fitLinear(points)).toBeNull();
  });
});

describe("WeightTrendChart — rendering", () => {
  beforeEach(() => cleanup());

  it("renders the empty-state message when fewer than 2 points are supplied", () => {
    render(<WeightTrendChart points={[{ date: "d1", weight: 300, trend: 300 }]} />);
    expect(screen.getByText(/Need 2\+ weight readings/i)).toBeTruthy();
  });

  it("renders the target ReferenceLine label when targetWeight is provided", () => {
    // Y-axis uses "auto" domain in the component; target must fall inside the
    // actual weight range, else Recharts clips the ReferenceLine label. Span
    // the actuals + projection from 300 → 450 so the target label lands.
    const points: WeightPoint[] = [
      { date: "01 Jan", weight: 300, trend: 300 },
      { date: "02 Jan", weight: 310, trend: 310 },
      { date: "15 Sep", weight: null, trend: null, projected: 450 },
    ];
    const { container } = render(
      <WeightTrendChart points={points} targetWeight={450} />,
    );
    expect(container.textContent).toContain("Target 450 kg");
  });

  it("renders the projected-reach ReferenceLine when projectedDate is provided", () => {
    // For Recharts category XAxis, `x` on a ReferenceLine must exactly match a
    // data-point label to paint. Use "15 Sep" consistently on both the data
    // row and the projectedDate prop.
    const points: WeightPoint[] = [
      { date: "01 Jan", weight: 300, trend: 300 },
      { date: "02 Jan", weight: 310, trend: 310 },
      { date: "15 Sep", weight: null, trend: null, projected: 450 },
    ];
    const { container } = render(
      <WeightTrendChart
        points={points}
        targetWeight={450}
        projectedDate="15 Sep"
      />,
    );
    expect(container.textContent).toContain("Projected reach");
  });

  it("preserves back-compat: callers that pass only { points, targetWeight, projectedDate } still render", () => {
    const points: WeightPoint[] = [
      { date: "01 Jan", weight: 300, trend: 300 },
      { date: "02 Jan", weight: 310, trend: 310 },
    ];
    const { container } = render(
      <WeightTrendChart points={points} targetWeight={450} projectedDate="15 Sep" />,
    );
    // Should have rendered a Recharts svg without crashing
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
