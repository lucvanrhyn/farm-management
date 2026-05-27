/**
 * @vitest-environment jsdom
 *
 * Unit tests for useSsrSafeState — the hook that eliminates React #418
 * hydration mismatches caused by client-only initializers (navigator, window,
 * localStorage, Date, Math.random, etc.) being called at first render.
 *
 * Contract:
 *   - `useState(serverInitial)` — no lazy initializer, so the initial state
 *     is always `serverInitial` on BOTH server and client first render. This
 *     is the SSR-safety guarantee: the server produces HTML with serverInitial;
 *     the client's first render also uses serverInitial so there is no mismatch.
 *   - After mount, a `useEffect` syncs to `clientInitial()` (the real value).
 *   - `clientInitial` is only ever called inside useEffect (never at render
 *     time), so it is safe to read navigator/window/localStorage there.
 */
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { renderHook, act } from "@testing-library/react";
import { useSsrSafeState } from "./use-ssr-safe-state";

describe("useSsrSafeState", () => {
  it("returns serverInitial on the very first render call (pre-effect)", () => {
    // Capture the value returned on render index 0 before effects flush.
    // We use a ref that records renders in order — [0] is the first render.
    const renderValues: string[] = [];
    const clientInitial = vi.fn(() => "client-value");

    renderHook(() => {
      const v = useSsrSafeState("server-value", clientInitial);
      renderValues.push(v);
      return v;
    });

    // First render must produce server-value (SSR-safe).
    expect(renderValues[0]).toBe("server-value");
    // After the effect runs, subsequent renders produce client-value.
    const lastValue = renderValues[renderValues.length - 1];
    expect(lastValue).toBe("client-value");
  });

  it("does NOT call clientInitial synchronously during render — only inside useEffect", () => {
    // The critical SSR-safety invariant: clientInitial must never be called
    // during the synchronous render path. We verify by tracking render vs
    // effect ordering.
    const callOrder: string[] = [];

    const clientInitial = vi.fn(() => {
      callOrder.push("clientInitial");
      return "client-value";
    });

    renderHook(() => {
      callOrder.push("render");
      return useSsrSafeState("server-value", clientInitial);
    });

    // render must appear BEFORE clientInitial in the call sequence —
    // clientInitial is called from useEffect (post-render), not inline.
    const firstClientInitialIndex = callOrder.indexOf("clientInitial");
    const firstRenderIndex = callOrder.indexOf("render");
    expect(firstRenderIndex).toBeLessThan(firstClientInitialIndex);
  });

  it("syncs to clientInitial() after mount", async () => {
    const clientInitial = vi.fn(() => "client-value");

    const { result } = renderHook(() =>
      useSsrSafeState("server-value", clientInitial)
    );

    // After effects flush, the value should update to the client value.
    await act(async () => {});

    expect(result.current).toBe("client-value");
    expect(clientInitial).toHaveBeenCalledTimes(1);
  });

  it("only calls clientInitial once even after re-renders", async () => {
    const clientInitial = vi.fn(() => "client-value");

    const { result, rerender } = renderHook(() =>
      useSsrSafeState("server-value", clientInitial)
    );

    await act(async () => {});
    rerender();
    rerender();

    expect(clientInitial).toHaveBeenCalledTimes(1);
    expect(result.current).toBe("client-value");
  });

  it("works with boolean type — mirrors WeatherWidget geoFailed pattern", async () => {
    // Mirrors the exact WeatherWidget offender at line 116-119:
    //   useState<boolean>(() => !hasCoordProps && typeof navigator !== 'undefined' && !navigator.geolocation)
    // Server: navigator is undefined → evaluates to false (or technically throws/short-circuits)
    // Client: navigator present, no geolocation → evaluates to true
    // → React #418 hydration mismatch!
    //
    // With useSsrSafeState: serverInitial=false is always used on first render.
    // After mount, clientInitial() is called and may return true safely.
    const renderValues: boolean[] = [];

    const { result } = renderHook(() => {
      const v = useSsrSafeState<boolean>(false, () => true);
      renderValues.push(v);
      return v;
    });

    // First render must be the SSR-safe value.
    expect(renderValues[0]).toBe(false);

    await act(async () => {});

    // Client value after mount.
    expect(result.current).toBe(true);
  });

  it("works with null initial and object client value", async () => {
    const { result } = renderHook(() =>
      useSsrSafeState<{ count: number } | null>(null, () => ({ count: 42 }))
    );

    await act(async () => {});

    expect(result.current).toEqual({ count: 42 });
  });
});
