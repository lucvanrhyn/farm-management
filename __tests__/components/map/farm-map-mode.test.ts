/**
 * Regression tests for issue #392 (PRD #389, Module 2):
 *
 *   Bug: `components/map/FarmMap.tsx` carried three independent boolean state
 *   pieces (`isDrawing`, `showDrawModal`, and `moveMode.active` via the
 *   `useMoveMode` hook). Nothing structurally prevented two of them being
 *   true at the same time, so the "drawing instructions" banner could remain
 *   visible while the MOVE MOB panel was already open — the exact overlap in
 *   `issue-basson-map-mode-overlap.png`.
 *
 *   Fix: a single `FarmMapMode` discriminated union plus a reducer. Each
 *   `startX` action returns the new mode; any other in-flight mode is
 *   dropped by construction. The JSX reads `mode.kind` (one slot), so two
 *   overlays cannot coexist.
 *
 * These tests exercise the reducer in isolation. The FarmMap.tsx integration
 * is covered by the existing component test surface plus type-checking.
 */
import { describe, it, expect } from "vitest";

import {
  farmMapModeReducer,
  type FarmMapMode,
  type FarmMapModeAction,
  IDLE,
} from "@/components/map/farm-map-mode";

describe("farmMapModeReducer", () => {
  describe("idle transitions", () => {
    it("idle + startDrawing → drawing-boundary", () => {
      const next = farmMapModeReducer(IDLE, { type: "startDrawing" });
      expect(next).toEqual({ kind: "drawing-boundary" });
    });

    it("idle + startMobMove → moving-mob (phase idle)", () => {
      const next = farmMapModeReducer(IDLE, { type: "startMobMove" });
      expect(next.kind).toBe("moving-mob");
      if (next.kind === "moving-mob") {
        expect(next.phase.tag).toBe("idle");
      }
    });

    it("idle + cancel → idle (no-op)", () => {
      const next = farmMapModeReducer(IDLE, { type: "cancel" });
      expect(next).toEqual({ kind: "idle" });
      // Same reference is fine but not required; equality is the contract.
    });

    it("idle + completeBoundary → idle (no-op when no boundary in flight)", () => {
      const next = farmMapModeReducer(IDLE, {
        type: "completeBoundary",
        geojson: "{}",
        hectares: 1,
      });
      expect(next).toEqual({ kind: "idle" });
    });
  });

  describe("mutual exclusion (the bug class)", () => {
    it("drawing-boundary + startMobMove → moving-mob (boundary dropped)", () => {
      const drawing: FarmMapMode = { kind: "drawing-boundary" };
      const next = farmMapModeReducer(drawing, { type: "startMobMove" });
      expect(next.kind).toBe("moving-mob");
    });

    it("naming-boundary + startMobMove → moving-mob (modal + boundary dropped)", () => {
      // Even with a staged boundary awaiting a name, starting a Mob Move
      // wipes the boundary so the modal can never overlap the move panel.
      const naming: FarmMapMode = {
        kind: "naming-boundary",
        geojson: '{"type":"Polygon","coordinates":[[]]}',
        hectares: 12.5,
      };
      const next = farmMapModeReducer(naming, { type: "startMobMove" });
      expect(next.kind).toBe("moving-mob");
    });

    it("moving-mob + startDrawing → drawing-boundary (mob dropped)", () => {
      const moving: FarmMapMode = {
        kind: "moving-mob",
        phase: { tag: "source_selected", campId: "C-001" },
      };
      const next = farmMapModeReducer(moving, { type: "startDrawing" });
      expect(next).toEqual({ kind: "drawing-boundary" });
    });

    it("drawing-boundary + startDrawing → idle (toggle-off)", () => {
      // The Draw button is a toggle: pressing it while drawing cancels the
      // in-flight draw. This is the user-visible "Cancel Drawing" affordance.
      const drawing: FarmMapMode = { kind: "drawing-boundary" };
      const next = farmMapModeReducer(drawing, { type: "startDrawing" });
      expect(next).toEqual({ kind: "idle" });
    });

    it("moving-mob + startMobMove → idle (toggle-off)", () => {
      // Same toggle semantics for the Move Mob button.
      const moving: FarmMapMode = {
        kind: "moving-mob",
        phase: { tag: "idle" },
      };
      const next = farmMapModeReducer(moving, { type: "startMobMove" });
      expect(next).toEqual({ kind: "idle" });
    });
  });

  describe("cancel returns to idle from any non-idle mode", () => {
    it("drawing-boundary + cancel → idle", () => {
      const next = farmMapModeReducer(
        { kind: "drawing-boundary" },
        { type: "cancel" }
      );
      expect(next).toEqual({ kind: "idle" });
    });

    it("naming-boundary + cancel → idle (drops staged boundary)", () => {
      const next = farmMapModeReducer(
        {
          kind: "naming-boundary",
          geojson: "{}",
          hectares: 3.14,
        },
        { type: "cancel" }
      );
      expect(next).toEqual({ kind: "idle" });
    });

    it("moving-mob + cancel → idle", () => {
      const next = farmMapModeReducer(
        {
          kind: "moving-mob",
          phase: {
            tag: "mob_selected",
            campId: "C-001",
            mob: {
              id: "M-1",
              name: "Herd A",
              animal_count: 12,
              current_camp: "C-001",
            },
          },
        },
        { type: "cancel" }
      );
      expect(next).toEqual({ kind: "idle" });
    });
  });

  describe("draw lifecycle", () => {
    it("drawing-boundary + boundaryDrawn(geojson, ha) → naming-boundary carrying the data", () => {
      const next = farmMapModeReducer(
        { kind: "drawing-boundary" },
        {
          type: "boundaryDrawn",
          geojson: '{"type":"Polygon"}',
          hectares: 7.5,
        }
      );
      expect(next).toEqual({
        kind: "naming-boundary",
        geojson: '{"type":"Polygon"}',
        hectares: 7.5,
      });
    });

    it("boundaryDrawn from idle is ignored (defensive)", () => {
      // The draw control only fires `create` when isDrawing is on, so this
      // is a no-op. But the reducer should not crash or transition.
      const next = farmMapModeReducer(IDLE, {
        type: "boundaryDrawn",
        geojson: "{}",
        hectares: 1,
      });
      expect(next).toEqual({ kind: "idle" });
    });

    it("naming-boundary + completeBoundary → idle (modal confirmed)", () => {
      const next = farmMapModeReducer(
        { kind: "naming-boundary", geojson: "{}", hectares: 2 },
        { type: "completeBoundary", geojson: "{}", hectares: 2 }
      );
      expect(next).toEqual({ kind: "idle" });
    });
  });

  describe("mob-move phase transitions stay encapsulated", () => {
    it("moving-mob + updateMobPhase → moving-mob with new phase", () => {
      const moving: FarmMapMode = {
        kind: "moving-mob",
        phase: { tag: "idle" },
      };
      const next = farmMapModeReducer(moving, {
        type: "updateMobPhase",
        phase: { tag: "source_selected", campId: "C-002" },
      });
      expect(next.kind).toBe("moving-mob");
      if (next.kind === "moving-mob") {
        expect(next.phase).toEqual({ tag: "source_selected", campId: "C-002" });
      }
    });

    it("updateMobPhase outside moving-mob is ignored", () => {
      const next = farmMapModeReducer(IDLE, {
        type: "updateMobPhase",
        phase: { tag: "source_selected", campId: "C-002" },
      });
      expect(next).toEqual({ kind: "idle" });
    });
  });

  describe("type-level exhaustiveness", () => {
    it("assertNever throws on an unknown action (runtime guard)", () => {
      // Compile-time exhaustiveness: if a new variant is added above without
      // a `case`, TypeScript flags `assertNever(action)` as an error because
      // `action` no longer narrows to `never`. At runtime, a forced
      // off-union action hits the assertNever branch and throws. This pins
      // the contract: the reducer is total over its declared action union.
      const unknown = { type: "futureAction" } as unknown as FarmMapModeAction;
      expect(() => farmMapModeReducer(IDLE, unknown)).toThrow(
        /unreachable action variant/
      );
    });
  });
});
