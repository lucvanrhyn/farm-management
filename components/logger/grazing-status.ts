import type { GrazingQuality, WaterStatus, FenceStatus } from "@/lib/types";
import type { Status } from "@/components/ds";

/**
 * Maps the domain `GrazingQuality` scale onto the design-system `Status`
 * scale used by <StatusDot> / <StatusPill> (var(--ft-good/fair/poor/crit)).
 *
 * Presentational only — the underlying grazing/condition logic and the
 * `getGrazingDot` / `getGrazingTailwindBg` Tailwind helpers (lib/utils.ts)
 * are untouched. This door only exists so the reskinned logger surface can
 * render the warm token-driven dot/pill instead of the old Tailwind chips.
 */
export function grazingToStatus(quality: GrazingQuality): Status {
  switch (quality) {
    case "Good":
      return "good";
    case "Fair":
      return "fair";
    case "Poor":
      return "poor";
    case "Overgrazed":
      return "critical";
  }
}

/** Water status → DS Status colour for the condition-icon row. */
export function waterToStatus(status: WaterStatus): Status {
  switch (status) {
    case "Full":
      return "good";
    case "Low":
      return "fair";
    case "Empty":
    case "Broken":
      return "critical";
  }
}

/** Fence status → DS Status colour for the condition-icon row. */
export function fenceToStatus(status: FenceStatus): Status {
  switch (status) {
    case "Intact":
      return "good";
    case "Damaged":
      return "critical";
  }
}

/** DS Status → token colour var, for inline icon colouring. */
export function statusVar(status: Status): string {
  switch (status) {
    case "good":
      return "var(--ft-good)";
    case "fair":
      return "var(--ft-fair)";
    case "poor":
      return "var(--ft-poor)";
    case "critical":
      return "var(--ft-crit)";
  }
}
