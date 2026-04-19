// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, act } from "@testing-library/react";
import React from "react";

import LayerToggle, {
  useLayerState,
  readLayerState,
  DEFAULT_LAYER_STATE,
  type LayerState,
} from "@/components/map/LayerToggle";

const STORAGE_KEY = "farmtrack.map.layers";

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("LayerToggle storage helpers", () => {
  it("readLayerState returns defaults when nothing persisted", () => {
    expect(readLayerState()).toEqual(DEFAULT_LAYER_STATE);
  });

  it("readLayerState merges persisted partial state over defaults", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ taskPins: true }));
    expect(readLayerState()).toEqual({ ...DEFAULT_LAYER_STATE, taskPins: true });
  });

  it("readLayerState falls back to defaults when storage is corrupt", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json{{");
    expect(readLayerState()).toEqual(DEFAULT_LAYER_STATE);
  });
});

describe("useLayerState hook", () => {
  it("hydrates defaults on mount and persists patches", () => {
    const { result } = renderHook(() => useLayerState());
    // After effect, state should equal defaults (nothing persisted yet).
    expect(result.current[0]).toEqual(DEFAULT_LAYER_STATE);

    act(() => {
      result.current[1]({ taskPins: true, afisFire: true });
    });

    expect(result.current[0].taskPins).toBe(true);
    expect(result.current[0].afisFire).toBe(true);
    // campOverlay should stay at its default.
    expect(result.current[0].campOverlay).toBe(true);

    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(persisted.taskPins).toBe(true);
    expect(persisted.afisFire).toBe(true);
  });

  it("hydrates from localStorage on mount when present", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ campOverlay: false, fmdZones: true })
    );
    const { result } = renderHook(() => useLayerState());
    expect(result.current[0].campOverlay).toBe(false);
    expect(result.current[0].fmdZones).toBe(true);
  });
});

describe("<LayerToggle />", () => {
  function Harness() {
    const [state, update] = useLayerState();
    return <LayerToggle value={state} onChange={update} />;
  }

  it("renders a checkbox for each of the 9 layers", () => {
    render(<Harness />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(9);
  });

  it("toggling a checkbox calls onChange with the patch", () => {
    const changes: Partial<LayerState>[] = [];
    const value = { ...DEFAULT_LAYER_STATE };
    render(<LayerToggle value={value} onChange={(p) => changes.push(p)} />);

    const taskPinsCheckbox = screen.getByLabelText(/tasks/i);
    fireEvent.click(taskPinsCheckbox);
    expect(changes).toEqual([{ taskPins: true }]);
  });
});
