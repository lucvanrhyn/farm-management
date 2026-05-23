"use client";

import type { ReactNode } from "react";

/**
 * Wave 262 — shared sticky Submit bar for the seven logger BottomSheet forms
 * (Health, Movement, Calving, Weighing, Treatment, Reproduction, Death).
 *
 * Why this exists
 * ---------------
 * Pre-#262 each form rendered its Submit button as the last child of an
 * `overflow-y-auto flex-1` BottomSheet body. On 390x844 (iPhone 12/13/14
 * baseline FarmTrack ships against) the user had to scroll past the
 * PhotoCapture preview AND every other field before reaching Submit, which
 * made one-handed in-paddock logging painful.
 *
 * Fix: wrap the Submit button in this bar. `position: sticky; bottom: 0`
 * pulls the row out of the scroll well so it sits permanently above the
 * content while still respecting iOS safe-area-inset on notched devices.
 *
 * Composition only — no HOC, no slot, no state hoisting. Each form keeps
 * its own Submit button + disabled-state + onClick logic; only the wrapping
 * markup changes. The `[data-sticky-submit-bar]` hook lets e2e + visual
 * regression suites locate the bar without coupling to class-name churn.
 */

interface Props {
  readonly children: ReactNode;
  readonly className?: string;
}

export default function StickySubmitBar({ children, className = "" }: Props) {
  return (
    <div
      data-sticky-submit-bar
      data-testid="sticky-submit-bar"
      className={`sticky bottom-0 -mx-5 px-5 pt-3 z-10 ${className}`.trim()}
      style={{
        // Translucent backdrop so the form content visible behind the bar
        // stays legible when scrolled-under.
        backgroundColor: "rgba(30, 15, 7, 0.92)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderTop: "1px solid rgba(92, 61, 46, 0.4)",
        // safe-area-inset-bottom via inline style — Tailwind/Lightning CSS
        // chokes on arbitrary padding values that wrap env() inside max().
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
      }}
    >
      {children}
    </div>
  );
}
