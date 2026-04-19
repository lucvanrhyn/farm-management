// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DaysOpenHistogram, { buildBins, meanBinLabel } from "@/components/admin/charts/DaysOpenHistogram";
import type { DaysOpenRecord } from "@/lib/server/reproduction-analytics";

// Recharts ResponsiveContainer uses getBoundingClientRect, which returns 0×0 in
// jsdom and suppresses the SVG tree. Replace it with a passthrough that clones
// the chart child with fixed width/height so ReferenceLine labels actually end
// up in the DOM for text assertions.
vi.mock("recharts", async () => {
  const actual = (await vi.importActual("recharts")) as Record<string, unknown>;
  const React = (await vi.importActual("react")) as typeof import("react");
  type ChartProps = { width?: number; height?: number };
  const ResponsiveContainer = ({ children }: { children: React.ReactElement<ChartProps> }) =>
    React.cloneElement(children, { width: 600, height: 220 });
  return { ...actual, ResponsiveContainer };
});

function rec(animalId: string, daysOpen: number | null): DaysOpenRecord {
  return {
    animalId,
    calvingDate: new Date("2025-01-01"),
    conceptionDate: daysOpen !== null ? new Date("2025-06-01") : null,
    daysOpen,
    isExtended: daysOpen === null || daysOpen > 90,
  };
}

describe("DaysOpenHistogram", () => {
  beforeEach(() => cleanup());

  it("buildBins groups days-open values into 20-day buckets", () => {
    const records = [
      rec("A", 10), // 0-20
      rec("B", 25), // 21-40
      rec("C", 85), // 81-100
      rec("D", 95), // 81-100 also
      rec("E", 201), // 200+
      rec("F", null), // ignored
    ];
    const bins = buildBins(records);
    const byLabel = Object.fromEntries(bins.map((b) => [b.label, b.count]));
    expect(byLabel["0-20"]).toBe(1);
    expect(byLabel["21-40"]).toBe(1);
    expect(byLabel["81-100"]).toBe(2);
    expect(byLabel["200+"]).toBe(1);
    // No animal sneaks into an unrelated bucket.
    expect(byLabel["41-60"]).toBe(0);
    expect(byLabel["101-120"]).toBe(0);
  });

  it("meanBinLabel picks the enclosing bin", () => {
    expect(meanBinLabel(15)).toBe("0-20");
    expect(meanBinLabel(95)).toBe("81-100");
    expect(meanBinLabel(250)).toBe("200+");
  });

  it("renders the target reference label at 95d", () => {
    const records = [rec("A", 85), rec("B", 95), rec("C", 120)];
    const { container } = render(<DaysOpenHistogram records={records} avgDaysOpen={100} />);
    // Recharts renders ReferenceLine labels as plain <text> inside the SVG; grep
    // the container string to assert the copy landed without depending on
    // role-based queries (Recharts doesn't set a11y roles on labels).
    expect(container.textContent).toContain("Target ≤95d");
  });

  it("renders the mean reference label with the supplied average", () => {
    const records = [rec("A", 80), rec("B", 100)];
    const { container } = render(<DaysOpenHistogram records={records} avgDaysOpen={90} />);
    expect(container.textContent).toContain("Mean 90d");
  });

  it("shows the empty state when there are zero records", () => {
    render(<DaysOpenHistogram records={[]} avgDaysOpen={null} />);
    expect(screen.getByText(/No calving → conception events recorded yet/i)).toBeTruthy();
  });

  it("does NOT render the mean reference when avgDaysOpen is null", () => {
    const records = [rec("A", 80)];
    const { container } = render(<DaysOpenHistogram records={records} avgDaysOpen={null} />);
    expect(container.textContent).not.toContain("Mean ");
  });
});
