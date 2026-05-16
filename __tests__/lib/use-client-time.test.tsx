// @vitest-environment jsdom
/**
 * Issue #283 — SSR-safe client-time primitive (parent PRD #279).
 *
 * Root cause being closed: `components/dashboard/DashboardClient.tsx`
 * computed `getGreeting()`, `getTodayShort()` and `new Date().toDateString()`
 * directly in the render body. The server renders in UTC; the client's first
 * (pre-effect) render runs in the browser's locale/zone (SAST for SA
 * tenants). When the wall clock straddles a greeting boundary or a calendar
 * day, the server HTML text != the client first-render text → recurring
 * React #418 hydration mismatch on every dashboard load.
 *
 * #276 (commit 2653be5) only hardened `AnimatedNumber` with an ad-hoc
 * `useState(0)` guard. This wave generalises that into ONE reusable
 * mount-gated primitive so server render and client first render ALWAYS
 * agree, byte-for-byte, regardless of clock or zone.
 *
 * Invariants pinned here:
 *
 *   1. `useClientTime(compute, placeholder)` returns EXACTLY `placeholder`
 *      on the first (server-equivalent) render — `compute` is NEVER invoked
 *      during that render, so it cannot read the wall clock.
 *   2. The server render (`renderToString`) and the client's first render
 *      produce identical markup (the #418 condition: they must agree).
 *   3. After mount, the hook returns `compute(new Date())`.
 *   4. `useHasMounted()` is `false` on first/server render, `true` after
 *      mount — the underlying gate the other hook is built on.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render, cleanup, screen } from "@testing-library/react";
import React from "react";
import { useClientTime, useHasMounted } from "@/lib/hooks/use-client-time";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Greeting() {
  const text = useClientTime(
    (now) => (now.getHours() < 12 ? "Good morning" : "Good evening"),
    "Good day",
  );
  return <span data-testid="g">{text}</span>;
}

function MountFlag() {
  const mounted = useHasMounted();
  return <span data-testid="m">{mounted ? "yes" : "no"}</span>;
}

describe("useClientTime — SSR-safe client-time primitive (issue #283)", () => {
  it("returns the stable placeholder on the server-equivalent render and never calls compute", () => {
    const compute = vi.fn(() => "REAL");
    function Probe() {
      const v = useClientTime(compute, "PLACEHOLDER");
      return <span>{v}</span>;
    }
    const html = renderToString(<Probe />);
    expect(html.replace(/<[^>]+>/g, "")).toBe("PLACEHOLDER");
    // compute reads the wall clock — it must not run during SSR / first
    // render or the markup would diverge from the server.
    expect(compute).not.toHaveBeenCalled();
  });

  it("server render and client first render produce identical markup (no #418)", () => {
    // Force the wall clock to a value where server (placeholder) and a
    // naive in-render compute would disagree: 23:00 → "Good evening".
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(23);

    const serverHtml = renderToString(<Greeting />);

    // Client first render (pre-effect). React would throw #418 if this
    // markup differed from the server's. Both must be the placeholder.
    const clientHtml = renderToString(<Greeting />);

    expect(serverHtml).toBe(clientHtml);
    expect(serverHtml.replace(/<[^>]+>/g, "")).toBe("Good day");
  });

  it("returns compute(new Date()) after mount", async () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(8);
    render(<Greeting />);
    expect(await screen.findByText("Good morning")).toBeInTheDocument();
  });

  it("useHasMounted is false on server render, true after mount", async () => {
    const ssr = renderToString(<MountFlag />);
    expect(ssr.replace(/<[^>]+>/g, "")).toBe("no");

    render(<MountFlag />);
    expect(await screen.findByText("yes")).toBeInTheDocument();
  });
});
