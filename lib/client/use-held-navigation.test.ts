/**
 * @vitest-environment jsdom
 *
 * Issue #447 — useHeldNavigation defers a navigation so a just-surfaced toast
 * is readable, while letting the user skip the wait with Esc.
 *
 * Contract:
 *   - holdMs > 0  → navigate is NOT called before holdMs elapses; called once
 *                   exactly at/after holdMs.
 *   - holdMs <= 0 → navigate fires synchronously (happy path, no latency).
 *   - Esc during the hold → navigate fires immediately and the pending timer
 *                   is cancelled (no double navigation when time later passes).
 *   - Unmount during the hold → navigate is never called (no push on a
 *                   torn-down tree).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHeldNavigation } from "./use-held-navigation";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("useHeldNavigation (#447)", () => {
  it("defers navigation by at least the hold window", () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useHeldNavigation(navigate));

    act(() => {
      result.current.scheduleHeldNavigation("/farm-x/logger", 1500);
    });

    // Not yet — the toast is still being read.
    expect(navigate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(navigate).not.toHaveBeenCalled();

    // Crosses the threshold → exactly one navigation.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/farm-x/logger");
  });

  it("navigates synchronously when holdMs <= 0 (happy path)", () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useHeldNavigation(navigate));

    act(() => {
      result.current.scheduleHeldNavigation("/farm-x/logger", 0);
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/farm-x/logger");
  });

  it("Esc skips the wait and navigates immediately, cancelling the timer", () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useHeldNavigation(navigate));

    act(() => {
      result.current.scheduleHeldNavigation("/farm-x/logger", 1500);
    });
    expect(navigate).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/farm-x/logger");

    // Letting the original window elapse must NOT navigate a second time.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("ignores Esc when no navigation is pending", () => {
    const navigate = vi.fn();
    renderHook(() => useHeldNavigation(navigate));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not navigate after unmount during the hold window", () => {
    const navigate = vi.fn();
    const { result, unmount } = renderHook(() => useHeldNavigation(navigate));

    act(() => {
      result.current.scheduleHeldNavigation("/farm-x/logger", 1500);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  // Regression: the original implementation re-subscribed the keydown effect on
  // every render (its `flush` dep churned with `navigate`/`router` identity),
  // and that effect's cleanup nulled the pending nav + cleared the timer. A
  // single re-render with a fresh `navigate` mid-hold therefore silently
  // dropped the navigation — the PR #515 gate flake.
  it("keeps the pending navigation across a re-render with a new navigate identity (timer path)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ nav }) => useHeldNavigation(nav),
      { initialProps: { nav: first } },
    );

    act(() => {
      result.current.scheduleHeldNavigation("/farm-x/logger", 1500);
    });
    // Fresh identity before the hold elapses — must NOT cancel the pending nav.
    rerender({ nav: second });

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    const calls = [...first.mock.calls, ...second.mock.calls];
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("/farm-x/logger");
  });

  it("Esc still flushes after a re-render with a new navigate identity (no lost or double nav)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ nav }) => useHeldNavigation(nav),
      { initialProps: { nav: first } },
    );

    act(() => {
      result.current.scheduleHeldNavigation("/farm-x/logger", 1500);
    });
    rerender({ nav: second });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    const afterEsc = [...first.mock.calls, ...second.mock.calls];
    expect(afterEsc).toHaveLength(1);
    expect(afterEsc[0][0]).toBe("/farm-x/logger");

    // Timer was cancelled by the Esc flush — no second navigation later.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(first.mock.calls.length + second.mock.calls.length).toBe(1);
  });
});
