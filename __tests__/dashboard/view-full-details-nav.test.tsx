/**
 * @vitest-environment jsdom
 *
 * Wave B / C4 — Codex audit 2026-05-10 found that "View Full Details →"
 * inside the schematic-map zoom card has the visual affordance of a
 * navigation control (label + arrow) but actually pops a side panel
 * overlay. A real per-camp surface already exists at
 *   /[farmSlug]/dashboard/camp/[campId]
 * (used by OverviewTab and AnimalsTable), so the fix is to route there
 * instead of rendering the overlay.
 *
 * Contract this test enforces:
 *   - DashboardClient routes onViewDetails(campId) to
 *     router.push(`/${farmSlug}/dashboard/camp/${campId}`).
 *   - It does NOT open the overlay-only side-panel state for that path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

const mockPush = vi.hoisted(() => vi.fn());
const mockOnViewDetails = vi.hoisted(() => ({ ref: null as ((campId: string) => void) | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ farmSlug: "test-farm" }),
  usePathname: () => "/test-farm/dashboard",
}));

vi.mock("@/lib/farm-mode", () => ({
  useFarmModeSafe: () => ({
    mode: "cattle" as const,
    setMode: () => {},
    enabledModes: ["cattle"] as const,
    isMultiMode: false,
  }),
}));

// Stub heavy children. SchematicMap is the surface under test for the
// onViewDetails wiring; capture the prop and expose a button that fires it
// so the test can drive it without mounting the full schematic + framer-motion
// machinery.
vi.mock("@/components/dashboard/SchematicMap", () => ({
  __esModule: true,
  default: (props: { onViewDetails: (campId: string) => void }) => {
    mockOnViewDetails.ref = props.onViewDetails;
    return (
      <button
        data-testid="schematic-view-details"
        onClick={() => props.onViewDetails("C1")}
      >
        View Full Details →
      </button>
    );
  },
}));

vi.mock("@/components/dashboard/DashboardSidePanel", () => ({
  __esModule: true,
  default: ({ panelOpen }: { panelOpen: boolean }) => (
    <div data-testid="side-panel" data-open={panelOpen ? "true" : "false"} />
  ),
}));

vi.mock("@/components/dashboard/DashboardStatsStrip", () => ({
  __esModule: true,
  default: () => <div data-testid="stats-strip" />,
}));

vi.mock("@/components/dashboard/WeatherWidget", () => ({
  __esModule: true,
  default: () => <div data-testid="weather" />,
}));

vi.mock("@/components/map/FarmMap", () => ({
  __esModule: true,
  default: () => <div data-testid="farm-map" />,
}));

vi.mock("@/components/logger/SignOutButton", () => ({
  __esModule: true,
  SignOutButton: () => <button>Sign out</button>,
}));

import DashboardClient from "@/components/dashboard/DashboardClient";

const baseProps = {
  totalAnimals: 0,
  campAnimalCounts: {},
  camps: [
    { camp_id: "C1", camp_name: "Camp One", size_hectares: 10 },
  ],
  latitude: null,
  longitude: null,
};

describe("DashboardClient — View Full Details navigation (C4)", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockOnViewDetails.ref = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("routes onViewDetails(campId) to /[farmSlug]/dashboard/camp/[campId]", () => {
    render(<DashboardClient {...baseProps} farmSlug="test-farm" />);

    const btn = screen.getByTestId("schematic-view-details");
    btn.click();

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/test-farm/dashboard/camp/C1");
  });

  it("does not open the side-panel overlay when View Full Details is clicked", () => {
    render(<DashboardClient {...baseProps} farmSlug="test-farm" />);

    const btn = screen.getByTestId("schematic-view-details");
    btn.click();

    const panel = screen.getByTestId("side-panel");
    expect(panel.getAttribute("data-open")).toBe("false");
  });
});
