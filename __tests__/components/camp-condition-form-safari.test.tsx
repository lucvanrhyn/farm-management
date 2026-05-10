// @vitest-environment jsdom
/**
 * __tests__/components/camp-condition-form-safari.test.tsx
 *
 * Wave D-U2 — Safari camp-condition modal viewport regression.
 *
 * Codex computer-use audit (tasks/audit-2026-05-10-codex.md, P2 row U2)
 * surfaced: "Camp condition modal hard to complete in Safari." Three
 * underlying CSS gaps fed into one symptom:
 *
 * 1. Bottom-sheet container used `max-h-[88vh]`. iOS Safari's static `vh`
 *    unit is locked to the *largest* viewport (URL bar collapsed), so the
 *    sheet overflows below the visible area when the toolbar is showing
 *    — Submit button falls off-screen.
 * 2. No `env(safe-area-inset-bottom)` padding on the scroll region. The
 *    Submit / Skip buttons sit under the iPhone home indicator.
 * 3. No body-scroll lock. The page behind the modal scrolls in response
 *    to touch-drag, frustrating data entry.
 *
 * The fix is pure CSS + a body-scroll-lock side effect in
 * components/logger/CampConditionForm.tsx — no prop change, no API change.
 *
 * This spec asserts the three contracts simultaneously; failing any one
 * blocks the regression from coming back.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

// PhotoCapture is irrelevant to the viewport-CSS contract — stub it out
// so the test doesn't need the camera/getUserMedia surface.
import { vi } from "vitest";
vi.mock("@/components/logger/PhotoCapture", () => ({
  __esModule: true,
  PhotoCapture: () => <div data-testid="photo-capture-stub" />,
}));

afterEach(() => {
  cleanup();
});

describe("CampConditionForm — Safari viewport + safe-area + scroll-lock (Wave D-U2)", () => {
  it("uses dvh (dynamic viewport) units for the bottom-sheet max height", async () => {
    const { default: CampConditionForm } = await import(
      "@/components/logger/CampConditionForm"
    );

    const { container } = render(
      <CampConditionForm campId="A" onClose={() => {}} />,
    );

    // The sheet container is the only element with both rounded-t and a
    // max-height rule. Find it by querying the className contract directly.
    const sheet = container.querySelector('[class*="rounded-t-3xl"]');
    expect(sheet, "bottom-sheet container must render").toBeTruthy();

    const cls = sheet!.className;
    // Dynamic viewport: collapses to actual visible height as iOS Safari's
    // URL bar appears. Static `vh` is the bug.
    expect(
      cls,
      `expected dvh viewport unit, got: ${cls}`,
    ).toMatch(/max-h-\[88dvh\]/);
    expect(
      cls,
      `static vh leaked into sheet className: ${cls}`,
    ).not.toMatch(/max-h-\[88vh\]/);
  });

  it("applies env(safe-area-inset-bottom) padding to the scroll region", async () => {
    const { default: CampConditionForm } = await import(
      "@/components/logger/CampConditionForm"
    );

    const { container } = render(
      <CampConditionForm campId="A" onClose={() => {}} />,
    );

    // Walk the rendered tree for any element whose inline style references
    // env(safe-area-inset-bottom) OR carries Tailwind's pb-safe utility.
    // Either satisfies the home-indicator clearance contract.
    const all = container.querySelectorAll<HTMLElement>("*");
    let hasSafeAreaPadding = false;
    for (const el of Array.from(all)) {
      const styleAttr = el.getAttribute("style") ?? "";
      const cls = el.className ?? "";
      if (
        styleAttr.includes("env(safe-area-inset-bottom)") ||
        /\bpb-safe\b/.test(typeof cls === "string" ? cls : "")
      ) {
        hasSafeAreaPadding = true;
        break;
      }
    }
    expect(
      hasSafeAreaPadding,
      "no element has env(safe-area-inset-bottom) padding or pb-safe class — Submit/Skip will fall under iPhone home indicator",
    ).toBe(true);
  });

  it("locks document.body scroll on mount and restores it on unmount", async () => {
    const { default: CampConditionForm } = await import(
      "@/components/logger/CampConditionForm"
    );

    // Establish a non-default starting overflow so we can verify the
    // restore step uses the *previous* value, not a hard-coded empty string.
    document.body.style.overflow = "auto";

    const result = render(<CampConditionForm campId="A" onClose={() => {}} />);

    expect(
      document.body.style.overflow,
      "body scroll must be locked while modal is mounted",
    ).toBe("hidden");

    result.unmount();

    expect(
      document.body.style.overflow,
      "body scroll must be restored to the previous value on unmount",
    ).toBe("auto");
  });
});
