// @vitest-environment jsdom
/**
 * Issue #458 — cancelling a boundary draw leaves the Mapbox GL Draw affordance
 * looking active (polygon/trash control highlighted, cursor stuck in draw
 * mode).
 *
 * Root cause: DrawControl wraps Mapbox GL Draw via react-map-gl's `useControl`.
 * The mode is set once at construction via `defaultMode` ("draw_polygon" while
 * enabled). The `useControl` cleanup callback only detaches the
 * `draw.create` / `draw.delete` listeners — it never returns the draw instance
 * to `simple_select`. So when drawing is cancelled the draw control is torn
 * down while still in `draw_polygon`, leaving its DOM affordance lingering
 * active.
 *
 * The fix is to call `draw.changeMode("simple_select")` at the START of the
 * `useControl` cleanup (`onRemove`), while the control is still attached (its
 * internal context is still defined — driving `changeMode` from a separate
 * React effect would race the attach lifecycle and throw "Cannot read
 * properties of undefined (reading 'changeMode')").
 *
 * The unit-testable seam is the disposal CALL ORDER: `changeMode("simple_select")`
 * must run BEFORE the `map.off(...)` detachments. The actual "affordance
 * visually clears" check needs a live GL context and is deferred to a
 * Playwright wave.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

// ── Capture the useControl callbacks so the test can drive the lifecycle. ──
const controlCapture: {
  factory?: () => unknown;
  onAdd?: (ctx: { map: unknown }) => void;
  onRemove?: (ctx: { map: unknown }) => void;
} = {};

vi.mock("react-map-gl/mapbox", () => ({
  // Mirror react-map-gl's signature: (factory, onAdd?, onRemove?, options?).
  // We capture all three so the test can call the factory to obtain the draw
  // instance and later invoke onRemove to simulate unmount (cancel).
  useControl: (
    factory: () => unknown,
    onAdd?: (ctx: { map: unknown }) => void,
    onRemove?: (ctx: { map: unknown }) => void
  ) => {
    controlCapture.factory = factory;
    controlCapture.onAdd = onAdd;
    controlCapture.onRemove = onRemove;
    return factory();
  },
}));

// ── Fake MapboxDraw instance exposing the methods the cleanup path touches. ──
const changeMode = vi.fn();

vi.mock("@mapbox/mapbox-gl-draw", () => ({
  // Must be a real constructor — DrawControl does `new MapboxDraw(...)`.
  default: class FakeMapboxDraw {
    changeMode = changeMode;
  },
}));

import DrawControl from "@/components/map/DrawControl";

// A fake map that records the order of changeMode vs off calls.
function makeMapWithOrderLog() {
  const order: string[] = [];
  const map = {
    on: vi.fn(),
    off: vi.fn((event: string) => order.push(`off:${event}`)),
  };
  // changeMode logs into the same array via the shared spy.
  changeMode.mockImplementation(() => order.push("changeMode"));
  return { map, order };
}

beforeEach(() => {
  changeMode.mockReset();
  controlCapture.factory = undefined;
  controlCapture.onAdd = undefined;
  controlCapture.onRemove = undefined;
});

afterEach(() => {
  cleanup();
});

describe("DrawControl cleanup (#458)", () => {
  it("returns the draw instance to simple_select on cleanup", () => {
    const { map } = makeMapWithOrderLog();

    render(
      <DrawControl
        onDrawCreate={() => {}}
        onDrawDelete={() => {}}
        enabled
      />
    );

    expect(controlCapture.onRemove).toBeTypeOf("function");
    controlCapture.onRemove?.({ map });

    expect(changeMode).toHaveBeenCalledWith("simple_select");
  });

  it("calls changeMode('simple_select') BEFORE detaching the draw listeners", () => {
    const { map, order } = makeMapWithOrderLog();

    render(
      <DrawControl
        onDrawCreate={() => {}}
        onDrawDelete={() => {}}
        enabled
      />
    );

    controlCapture.onRemove?.({ map });

    // The mode reset must precede every map.off detachment, otherwise the
    // draw instance is torn down while still in draw_polygon.
    const changeModeIdx = order.indexOf("changeMode");
    const firstOffIdx = order.findIndex((e) => e.startsWith("off:"));
    expect(changeModeIdx).toBeGreaterThanOrEqual(0);
    expect(firstOffIdx).toBeGreaterThanOrEqual(0);
    expect(changeModeIdx).toBeLessThan(firstOffIdx);
  });
});
