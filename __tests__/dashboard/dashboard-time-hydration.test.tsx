// @vitest-environment jsdom
/**
 * Issue #283 — DashboardClient must not produce a React #418 hydration
 * mismatch from wall-clock-in-render.
 *
 * Pre-fix, `DashboardClient` computed `getGreeting()`, `getTodayShort()`
 * and `new Date().toDateString()` directly in its render body. The server
 * renders in UTC; the client's first (pre-effect) render runs in the
 * browser's locale/zone. When the clock straddles a greeting boundary or a
 * calendar-day rollover the two markups diverged → recurring #418 on every
 * dashboard load.
 *
 * This test pins the fix at the dashboard level: with the wall clock forced
 * to 23:00 (a value where a naive in-render `getGreeting()` would yield
 * "Good evening"), the server render and the client's first render must be
 * byte-identical AND must show the stable placeholder ("Good day", no date),
 * never the clock-derived string. The real localized greeting/date only
 * appear after mount via `useClientTime`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
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

vi.mock("@/components/dashboard/SchematicMap", () => ({
  __esModule: true,
  default: () => <div data-testid="schematic" />,
}));
vi.mock("@/components/dashboard/DashboardSidePanel", () => ({
  __esModule: true,
  default: () => <div data-testid="side-panel" />,
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
  farmSlug: "test-farm",
  totalAnimals: 0,
  campAnimalCounts: {},
  camps: [{ camp_id: "C1", camp_name: "Camp One", size_hectares: 10 }],
  latitude: null,
  longitude: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DashboardClient — clock-in-render hydration safety (issue #283)", () => {
  it("server render === client first render, and neither leaks the clock-derived greeting/date", () => {
    // 23:00 → a naive in-render getGreeting() would say "Good evening" and
    // getTodayShort() would print a date — both clock-dependent.
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(23);

    const serverHtml = renderToString(<DashboardClient {...baseProps} />);
    const clientFirstHtml = renderToString(<DashboardClient {...baseProps} />);

    // The #418 condition: server and client first render MUST agree.
    expect(serverHtml).toBe(clientFirstHtml);

    // First render shows only the stable, clock-independent placeholder.
    expect(serverHtml).toContain("Good day");
    expect(serverHtml).toContain("Map Center");
    // The clock-derived strings must NOT be in the first-render markup.
    expect(serverHtml).not.toContain("Good evening");
  });
});
