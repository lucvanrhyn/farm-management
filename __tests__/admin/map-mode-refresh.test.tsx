// @vitest-environment jsdom
/**
 * Wave 233 — flipping the FarmMode toggle re-renders the map surfaces via
 * `router.refresh()` (no full page reload). The server fetch (already proven
 * by `map-species-filter.test.tsx`) re-runs with the new cookie and the
 * client receives a fresh species-scoped camps prop.
 *
 * We mock router.refresh and assert it fires when `mode` changes — that's
 * the mechanism the dashboard + admin map clients rely on for live updates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { FarmModeProvider, useFarmMode } from "@/lib/farm-mode";

const refreshMock = vi.fn();

vi.mock("next/navigation", async () => {
  const actual =
    await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      refresh: refreshMock,
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    }),
    usePathname: () => "/trio-b/admin/map",
    useSearchParams: () => new URLSearchParams(),
  };
});

// Heavy children we don't care about for this contract.
vi.mock("@/components/map/FarmMap", () => ({ default: () => null }));
vi.mock("@/components/map/LogAtSpotSheet", () => ({ default: () => null }));
vi.mock("@/components/dashboard/SchematicMap", () => ({ default: () => null }));
vi.mock("@/components/dashboard/WeatherWidget", () => ({ default: () => null }));
vi.mock("@/components/dashboard/DashboardStatsStrip", () => ({
  default: () => null,
}));
vi.mock("@/components/dashboard/DashboardSidePanel", () => ({
  default: () => null,
}));
vi.mock("@/components/logger/SignOutButton", () => ({
  SignOutButton: () => null,
}));
// next/dynamic in node/jsdom tests: short-circuit to the inner component
// being rendered as null — we only care about the useEffect on mode.
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

beforeEach(() => {
  refreshMock.mockClear();
  // Avoid leaking storage between tests.
  if (typeof window !== "undefined") {
    window.localStorage.clear();
    document.cookie =
      "farmtrack-mode-trio-b=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  }
});

afterEach(() => {
  cleanup();
});

// Helper that flips the mode from inside the provider tree.
function ModeFlipper({ to }: { to: "cattle" | "sheep" }) {
  const { setMode } = useFarmMode();
  return (
    <button data-testid="flip" onClick={() => setMode(to)}>
      flip
    </button>
  );
}

describe("Wave 233 — AdminMapClient calls router.refresh() on mode flip", () => {
  it("flipping cattle → sheep triggers router.refresh()", async () => {
    const { default: AdminMapClient } = await import(
      "@/app/[farmSlug]/admin/map/AdminMapClient"
    );

    const { getByTestId } = render(
      <FarmModeProvider
        farmSlug="trio-b"
        enabledSpecies={["cattle", "sheep"]}
      >
        <AdminMapClient
          farmSlug="trio-b"
          tier="advanced"
          campData={[]}
          farmLat={-33}
          farmLng={22}
        />
        <ModeFlipper to="sheep" />
      </FarmModeProvider>,
    );

    // Initial mount may or may not invoke refresh (implementation choice
    // is "fire on changes only" — we'll lock that behaviour below). Reset
    // so the assertion only covers the flip.
    refreshMock.mockClear();

    await act(async () => {
      getByTestId("flip").click();
    });

    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("Wave 233 — DashboardClient calls router.refresh() on mode flip", () => {
  it("flipping cattle → sheep triggers router.refresh()", async () => {
    const { default: DashboardClient } = await import(
      "@/components/dashboard/DashboardClient"
    );

    const { getByTestId } = render(
      <FarmModeProvider
        farmSlug="trio-b"
        enabledSpecies={["cattle", "sheep"]}
      >
        <DashboardClient
          farmSlug="trio-b"
          totalAnimals={88}
          totalBySpecies={{ cattle: 88, sheep: 5 }}
          campAnimalCounts={{}}
          campCountsBySpecies={{ cattle: {}, sheep: {} }}
          camps={[]}
          latitude={-33}
          longitude={22}
          censusCountByCamp={{}}
          rotationByCampId={{}}
          veldScoreByCamp={{}}
          feedOnOfferKgDmPerHaByCamp={{}}
        />
        <ModeFlipper to="sheep" />
      </FarmModeProvider>,
    );

    refreshMock.mockClear();

    await act(async () => {
      getByTestId("flip").click();
    });

    expect(refreshMock).toHaveBeenCalled();
  });
});
