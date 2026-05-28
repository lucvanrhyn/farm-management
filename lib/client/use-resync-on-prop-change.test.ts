/**
 * @vitest-environment jsdom
 *
 * Unit tests for useResyncOnPropChange — the hook that resets a piece of
 * local state back to a freshly-computed value whenever a `trigger` prop
 * changes, using React's official "adjusting state on a prop change" recipe
 * (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
 *
 * Contract:
 *   - Behaves like `useState`: returns `[state, setState]`.
 *   - On the FIRST render, state is `compute()`.
 *   - While `trigger` is unchanged across re-renders, local edits made through
 *     the returned setState PERSIST (it is genuine local state, not derived).
 *   - When `trigger` changes (Object.is comparison), state is synchronously
 *     reset to `compute()` during render — exactly once per change. Local edits
 *     made before the change are discarded.
 *   - `compute` is called once at mount, then exactly once per trigger change.
 *     It is NOT called on every render.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResyncOnPropChange } from "./use-resync-on-prop-change";

describe("useResyncOnPropChange", () => {
  it("returns compute() on the first render", () => {
    const { result } = renderHook(() =>
      useResyncOnPropChange("trigger-a", () => "value-a"),
    );

    expect(result.current[0]).toBe("value-a");
  });

  it("persists local setState edits while the trigger is unchanged", () => {
    const { result, rerender } = renderHook(
      ({ trigger }: { trigger: string }) =>
        useResyncOnPropChange(trigger, () => "initial"),
      { initialProps: { trigger: "a" } },
    );

    act(() => result.current[1]("edited"));
    expect(result.current[0]).toBe("edited");

    // Re-render with the SAME trigger — the edit must survive.
    rerender({ trigger: "a" });
    expect(result.current[0]).toBe("edited");
  });

  it("resets state to compute() when the trigger changes, discarding edits", () => {
    let computeFor = "a";
    const { result, rerender } = renderHook(
      ({ trigger }: { trigger: string }) =>
        useResyncOnPropChange(trigger, () => `computed-${computeFor}`),
      { initialProps: { trigger: "a" } },
    );

    // Mutate local state away from the computed value.
    act(() => result.current[1]("edited"));
    expect(result.current[0]).toBe("edited");

    // Trigger changes — compute() now produces a fresh value.
    computeFor = "b";
    rerender({ trigger: "b" });

    expect(result.current[0]).toBe("computed-b");
  });

  it("recomputes EXACTLY once per trigger change — not on every render", () => {
    const compute = vi.fn(() => "x");
    const { rerender } = renderHook(
      ({ trigger }: { trigger: string }) =>
        useResyncOnPropChange(trigger, compute),
      { initialProps: { trigger: "a" } },
    );

    // Mount counts as one call.
    expect(compute).toHaveBeenCalledTimes(1);

    // Re-renders with the same trigger must NOT recompute.
    rerender({ trigger: "a" });
    rerender({ trigger: "a" });
    expect(compute).toHaveBeenCalledTimes(1);

    // A single trigger change → exactly one more compute.
    rerender({ trigger: "b" });
    expect(compute).toHaveBeenCalledTimes(2);

    // Holding at "b" must not recompute again.
    rerender({ trigger: "b" });
    expect(compute).toHaveBeenCalledTimes(2);

    // Another change → one more.
    rerender({ trigger: "c" });
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("supports the functional-updater form of setState", () => {
    const { result } = renderHook(() =>
      useResyncOnPropChange<number>("t", () => 1),
    );

    act(() => result.current[1]((prev) => prev + 10));
    expect(result.current[0]).toBe(11);
  });

  it("treats a numeric trigger change correctly (Object.is)", () => {
    const { result, rerender } = renderHook(
      ({ trigger }: { trigger: number }) =>
        useResyncOnPropChange(trigger, () => trigger * 2),
      { initialProps: { trigger: 5 } },
    );

    expect(result.current[0]).toBe(10);

    act(() => result.current[1](999));
    expect(result.current[0]).toBe(999);

    rerender({ trigger: 6 });
    expect(result.current[0]).toBe(12);
  });

  it("does not reset when an unrelated re-render occurs with an equal trigger", () => {
    const compute = vi.fn(() => "fresh");
    const { result, rerender } = renderHook(
      ({ trigger, extra }: { trigger: string; extra: number }) => {
        // `extra` forces a re-render without touching the trigger.
        void extra;
        return useResyncOnPropChange(trigger, compute);
      },
      { initialProps: { trigger: "a", extra: 0 } },
    );

    act(() => result.current[1]("local"));
    expect(result.current[0]).toBe("local");

    rerender({ trigger: "a", extra: 1 });
    rerender({ trigger: "a", extra: 2 });

    expect(result.current[0]).toBe("local");
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
