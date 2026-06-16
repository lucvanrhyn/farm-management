/**
 * @vitest-environment jsdom
 *
 * ProfitPerCampTableClient — sortable per-camp profit table.
 *
 * Contract:
 *   - Renders one row per camp with profit / per-LSU / per-ha figures.
 *   - Sorting by profit (default), per-LSU, per-ha re-orders rows.
 *   - Null per-LSU / per-ha render "—" (never NaN / null text).
 *   - The unallocated line renders separately (overhead never spread).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import ProfitPerCampTableClient from "@/components/admin/profit-per-camp/ProfitPerCampTableClient";
import type { ProfitPerCampRow } from "@/lib/calculators/profit-per-camp";

afterEach(cleanup);

const ROWS: ProfitPerCampRow[] = [
  {
    campId: "camp-1",
    campName: "North",
    income: 10000,
    cost: 2000,
    profit: 8000,
    lsu: 4,
    profitPerLsu: 2000,
    hectares: 20,
    profitPerHa: 400,
  },
  {
    campId: "camp-2",
    campName: "South",
    income: 5000,
    cost: 1000,
    profit: 4000,
    lsu: 0,
    profitPerLsu: null, // LSU = 0 -> null
    hectares: null,
    profitPerHa: null, // no hectares -> null
  },
];

const UNALLOCATED = { income: 1500, cost: 600, net: 900 };

function dataRows() {
  return screen
    .getAllByRole("row")
    .filter((r) => within(r).queryByText(/North|South/));
}

describe("ProfitPerCampTableClient", () => {
  it("renders a row per camp with the camp name", () => {
    render(<ProfitPerCampTableClient rows={ROWS} unallocated={UNALLOCATED} />);
    expect(screen.getByText("North")).toBeTruthy();
    expect(screen.getByText("South")).toBeTruthy();
  });

  it('renders "—" for null per-LSU and per-ha', () => {
    render(<ProfitPerCampTableClient rows={ROWS} unallocated={UNALLOCATED} />);
    const southRow = dataRows().find((r) => within(r).queryByText("South"))!;
    // South has both per-LSU and per-ha null -> two em-dashes in that row.
    const dashes = within(southRow).getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("defaults to sorting by profit descending", () => {
    render(<ProfitPerCampTableClient rows={ROWS} unallocated={UNALLOCATED} />);
    const names = dataRows().map((r) =>
      within(r).queryByText("North") ? "North" : "South",
    );
    expect(names).toEqual(["North", "South"]);
  });

  it("re-sorts when a sort control is clicked (profit asc toggle)", () => {
    render(<ProfitPerCampTableClient rows={ROWS} unallocated={UNALLOCATED} />);
    // Click the Profit header once to flip to ascending.
    fireEvent.click(screen.getByRole("button", { name: /profit/i }));
    const names = dataRows().map((r) =>
      within(r).queryByText("North") ? "North" : "South",
    );
    expect(names).toEqual(["South", "North"]);
  });

  it("renders the unallocated line separately", () => {
    render(<ProfitPerCampTableClient rows={ROWS} unallocated={UNALLOCATED} />);
    expect(screen.getByText(/unallocated/i)).toBeTruthy();
  });
});
