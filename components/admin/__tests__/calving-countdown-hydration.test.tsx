// @vitest-environment jsdom
/**
 * CalvingCountdownBadge — the "Upcoming Calvings" relative-day badge in
 * BreedingDashboard must not read the wall clock during its render body.
 *
 * Pre-fix, BreedingDashboard computed `Math.round((expectedDate - Date.now())
 * / DAY)` inline in render and rendered "5d away" / "Today" / "2d overdue".
 * The server renders at instant T (UTC); the client's first render runs at
 * T+δ in the browser zone. When that straddles a calendar-day rollover the day
 * count is off by one → server "5d away" vs client "4d away" → React #418.
 *
 * The fix mount-gates the countdown (lib/hooks/use-client-time → useHasMounted):
 * the first (server-equivalent) render shows a stable placeholder, and the
 * clock-derived label only appears after the client has mounted. So server
 * render and client first render are byte-identical regardless of when the
 * clock is read.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { cleanup } from "@testing-library/react";
import { CalvingCountdownBadge } from "@/components/admin/BreedingDashboard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CalvingCountdownBadge — clock-in-render hydration safety (#418)", () => {
  it("server render === client first render, and neither leaks the clock-derived countdown", () => {
    // Two renders a calendar day apart — a naive in-render countdown would
    // disagree across this boundary.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-01T23:59:00Z"));
    const serverHtml = renderToString(<CalvingCountdownBadge expectedDate="2026-07-10" />);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-02T00:01:00Z"));
    const clientFirstHtml = renderToString(<CalvingCountdownBadge expectedDate="2026-07-10" />);

    expect(serverHtml).toBe(clientFirstHtml);
    // The clock-derived countdown must NOT be in the first-render markup.
    expect(serverHtml).not.toMatch(/\dd away|\dd overdue|Today/);
  });
});
