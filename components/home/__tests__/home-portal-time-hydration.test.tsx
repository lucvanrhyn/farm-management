// @vitest-environment jsdom
/**
 * HomePortal must not produce a React #418 hydration mismatch from reading the
 * wall clock in its render body.
 *
 * Pre-fix, HomePortal computed `new Date()` / `getHours()` / `formatDate(now)`
 * directly in render and rendered `greetingFor(hour)` + the formatted date. The
 * server renders in UTC; the client's first (pre-effect) render runs in the
 * browser's locale/zone — so when the clock straddled a greeting boundary the
 * two markups diverged → the recurring #418 the live walk caught on /home.
 *
 * Sibling of __tests__/dashboard/dashboard-time-hydration.test.tsx. With the
 * clock forced to 23:00 (where a naive in-render greeting says "Good evening"),
 * server render and the client's first render must be byte-identical and show
 * only the stable placeholder ("Good day"), never the clock-derived greeting.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { cleanup } from "@testing-library/react";

vi.mock("@/hooks/useAssistantName", () => ({
  useAssistantName: () => "Einstein",
}));

import HomePortal from "@/components/home/HomePortal";

const baseProps = {
  farmName: "Trio B Boerdery",
  breed: "Brangus",
  owner: "Luc van Rhyn",
  animalCount: 875,
  campCount: 19,
  sections: { admin: "Herd, camps & data", logger: "Camp rounds", map: "Farm map" },
  mode: "cattle" as const,
  isMultiMode: false,
  onSetMode: () => {},
  onNavigate: () => {},
  onAskEinstein: () => {},
  onSignOut: () => {},
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HomePortal — clock-in-render hydration safety (#418)", () => {
  it("server render === client first render, and neither leaks the clock-derived greeting", () => {
    // 23:00 → a naive in-render greetingFor() would say "Good evening".
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(23);

    const serverHtml = renderToString(<HomePortal {...baseProps} />);
    const clientFirstHtml = renderToString(<HomePortal {...baseProps} />);

    // The #418 condition: server and client first render MUST agree.
    expect(serverHtml).toBe(clientFirstHtml);

    // First render shows only the stable, clock-independent placeholder.
    expect(serverHtml).toContain("Good day");
    // The clock-derived greeting must NOT be in the first-render markup.
    expect(serverHtml).not.toContain("Good evening");
  });
});
