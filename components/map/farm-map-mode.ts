/**
 * FarmMap mode — single discriminated union state for the FarmMap shell.
 *
 * Issue #392 (PRD #389, Module 2):
 *   Replace `isDrawing`, `showDrawModal`, and the implicit `moveMode.active`
 *   booleans in `components/map/FarmMap.tsx` with one source of truth. The
 *   union has exactly one inhabitant at a time — opening a Mob Move while
 *   a boundary draw is in flight discards the draw by construction, so the
 *   overlap visible in `issue-basson-map-mode-overlap.png` becomes
 *   impossible to render.
 *
 * The mob-move sub-phase (idle / source_selected / mob_selected /
 * dest_selected) stays nested inside the `moving-mob` variant. Callers
 * read `mode.kind` for the top-level slot decision and `mode.phase.tag`
 * for the inner workflow step.
 */
import type { MobInfo } from "./useMoveMode";

// ── Inner phase for the mob-move flow (mirrors useMoveMode's local Phase). ──
// Lifted here so the union can carry it and the reducer can stay pure.

export type MobMovePhase =
  | { tag: "idle" }
  | { tag: "source_selected"; campId: string }
  | { tag: "mob_selected"; campId: string; mob: MobInfo }
  | { tag: "dest_selected"; campId: string; mob: MobInfo; destCampId: string };

// ── Top-level mode union ─────────────────────────────────────────────────────

export type FarmMapMode =
  | { kind: "idle" }
  | { kind: "drawing-boundary" }
  | { kind: "naming-boundary"; geojson: string; hectares: number }
  | { kind: "moving-mob"; phase: MobMovePhase };

export const IDLE: FarmMapMode = { kind: "idle" };
const MOB_IDLE: MobMovePhase = { tag: "idle" };

// ── Actions ──────────────────────────────────────────────────────────────────

export type FarmMapModeAction =
  | { type: "startDrawing" }
  | { type: "startMobMove" }
  | { type: "boundaryDrawn"; geojson: string; hectares: number }
  | { type: "completeBoundary"; geojson: string; hectares: number }
  | { type: "updateMobPhase"; phase: MobMovePhase }
  | { type: "cancel" };

// ── Reducer ──────────────────────────────────────────────────────────────────

function assertNever(_x: never): never {
  // Compile-time exhaustiveness check. At runtime we just throw — callers
  // hit a runtime-only branch only if a future action variant is added
  // without updating this switch.
  throw new Error("farmMapModeReducer: unreachable action variant");
}

/**
 * Pure transition function. No side effects, no React. The state's `kind`
 * field is the single source of truth for "which panel is on screen".
 *
 * Mutual-exclusion rule: any action that starts a new top-level mode drops
 * whatever was in flight. The button affordances (Draw / Move Mob) are
 * toggles — pressing the same start* action while already in that kind
 * returns to `idle`.
 */
export function farmMapModeReducer(
  state: FarmMapMode,
  action: FarmMapModeAction
): FarmMapMode {
  switch (action.type) {
    case "startDrawing":
      // Toggle: pressing Draw while already drawing or naming cancels.
      if (state.kind === "drawing-boundary" || state.kind === "naming-boundary") {
        return IDLE;
      }
      return { kind: "drawing-boundary" };

    case "startMobMove":
      // Toggle: pressing Move Mob while already moving cancels.
      if (state.kind === "moving-mob") {
        return IDLE;
      }
      return { kind: "moving-mob", phase: MOB_IDLE };

    case "boundaryDrawn":
      // Only valid mid-draw. From any other mode this is a no-op (defensive
      // against stale events from a still-mounted DrawControl).
      if (state.kind === "drawing-boundary") {
        return {
          kind: "naming-boundary",
          geojson: action.geojson,
          hectares: action.hectares,
        };
      }
      return state;

    case "completeBoundary":
      // Modal-confirm exit path. The geojson/hectares fields on the action
      // are advisory — they match the in-flight boundary by construction.
      // From any other mode this is a no-op.
      if (state.kind === "naming-boundary") {
        return IDLE;
      }
      return state;

    case "updateMobPhase":
      // Only valid while in moving-mob; reject otherwise.
      if (state.kind === "moving-mob") {
        return { kind: "moving-mob", phase: action.phase };
      }
      return state;

    case "cancel":
      return IDLE;

    default:
      // Type-level exhaustiveness check. If a new variant is added above,
      // TypeScript will flag this as an error (action narrowed to never
      // here means the switch is total).
      return assertNever(action);
  }
}
