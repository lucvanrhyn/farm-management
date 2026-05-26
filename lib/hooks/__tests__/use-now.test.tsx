// @vitest-environment jsdom
/**
 * Issue #422 (parent PRD #419) — `useNow(intervalMs)`: SSR-safe ticking-time
 * primitive.
 *
 * Why this exists
 * ---------------
 * `components/logger/LoggerStatusBar` rendered a "Synced: 5m ago" string by
 * calling `Date.now()` at the top of `formatRelativeTime` — i.e. during the
 * render body. Because `LoggerStatusBar` is mounted from an RSC
 * (`app/[farmSlug]/logger/page.tsx`), the SSR pass and the client's first
 * (pre-effect) render both run `Date.now()`, but at different wall-clock
 * instants. As soon as the ms-skew crosses a "minute" boundary, the server
 * string ("4m ago") and the client first render ("5m ago") diverge → React
 * #418 hydration mismatch on every Logger load. Same class of bug as the
 * AdminNav fix in PR #388 / commit `f4a3de9`.
 *
 * `useClientTime(compute, placeholder)` already solves the one-shot case
 * (compute once after mount). `useNow(intervalMs, seed?)` solves the
 * ticking case (re-render every `intervalMs` so "X ago" strings stay
 * fresh), with the same hydration-safe shape:
 *
 *   1. First (server-equivalent) render returns the deterministic `seed`
 *      (defaults to `0`) — never the wall clock. Server and client first
 *      render therefore agree byte-for-byte.
 *   2. After mount, an effect seeds `now = Date.now()` and a `setInterval`
 *      bumps it every `intervalMs`.
 *   3. The interval is cleared on unmount (no leaked timer).
 *
 * Tests below pin all three invariants. They use `vi.useFakeTimers()` so
 * the interval advance is deterministic and the "no leak after unmount"
 * assertion can be made without racing real time.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render, cleanup, screen, act } from "@testing-library/react";
import React from "react";
import { useNow } from "@/lib/hooks/use-now";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Probe({ intervalMs, seed }: { intervalMs: number; seed?: number }) {
  const now = useNow(intervalMs, seed);
  return <span data-testid="n">{String(now)}</span>;
}

describe("useNow(intervalMs, seed) — SSR-safe ticking-time primitive (#422)", () => {
  it("returns the seed (default 0) on the server-equivalent render", () => {
    // SSR pass — must NOT read the wall clock.
    const html = renderToString(<Probe intervalMs={60_000} />);
    expect(html.replace(/<[^>]+>/g, "")).toBe("0");
  });

  it("returns the explicit seed when one is supplied (deterministic SSR)", () => {
    const html = renderToString(<Probe intervalMs={60_000} seed={42} />);
    expect(html.replace(/<[^>]+>/g, "")).toBe("42");
  });

  it("server render and client first render are byte-for-byte identical (no #418)", () => {
    // Force a non-trivial wall-clock value so a naive in-render `Date.now()`
    // would absolutely diverge between server and client.
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const serverHtml = renderToString(<Probe intervalMs={60_000} />);
    const clientFirstRender = renderToString(<Probe intervalMs={60_000} />);
    expect(clientFirstRender).toBe(serverHtml);
    // And it's the seed, not the wall clock — proves `Date.now()` was not
    // consulted during render.
    expect(serverHtml.replace(/<[^>]+>/g, "")).toBe("0");
  });

  it("advances the returned value after one interval tick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 26, 12, 0, 0));

    render(<Probe intervalMs={1000} />);
    // First render: seed (0).
    expect(screen.getByTestId("n").textContent).toBe("0");

    // Run the post-mount effect (microtask → seeds `now = Date.now()` and
    // installs the interval) and tick once.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // flush microtasks
    });
    const afterSeed = Number(screen.getByTestId("n").textContent);
    expect(afterSeed).toBeGreaterThan(0);

    // Advance fake time past one interval — the hook should re-render with
    // a strictly larger value.
    await act(async () => {
      vi.setSystemTime(new Date(2026, 4, 26, 12, 0, 1));
      await vi.advanceTimersByTimeAsync(1000);
    });
    const afterTick = Number(screen.getByTestId("n").textContent);
    expect(afterTick).toBeGreaterThan(afterSeed);
  });

  it("clears the interval on unmount (no leaked timer)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 26, 12, 0, 0));

    const { unmount } = render(<Probe intervalMs={1000} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Snapshot the active-timer count, unmount, then assert no NEW callback
    // fires when we advance time past several would-be intervals.
    const before = vi.getTimerCount();
    expect(before).toBeGreaterThan(0); // the setInterval is live

    unmount();
    // After unmount, the cleanup must have called clearInterval — so
    // the timer count drops back to whatever React's own bookkeeping
    // left behind (which for an unmounted tree is 0 from our hook).
    expect(vi.getTimerCount()).toBeLessThan(before);
  });
});
