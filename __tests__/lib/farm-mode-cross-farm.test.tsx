// @vitest-environment jsdom
/**
 * Adversarial Bug 3 (HIGH) — FarmModeProvider leaks species across farms.
 *
 * `useState` initializer runs once at mount and reads `getStoredMode(farmA)`.
 * The cookie-write effect at line 100-102 fires on every render whose deps
 * (farmSlug, mode) changed — when navigation switches farmSlug from "farm-a"
 * to "farm-b", `mode` is still "sheep" (never re-derived from farm-b's
 * storage), and the effect writes `mode-farm-b=sheep`, OVERWRITING farm-b's
 * stored "cattle". The next read (server component, page reload) sees the
 * wrong mode and species-filters Prisma queries against the wrong species.
 *
 * Repro is mounted ONCE — the same provider instance is re-rendered with a
 * different `farmSlug` prop. This mirrors what Next App Router does on a
 * `[farmSlug]/...` → `[farmSlug2]/...` navigation: the layout's params
 * change but client providers above the layout boundary stay mounted.
 *
 * Hard requirement: do NOT add `key={farmSlug}` to the provider as a
 * workaround. The fix lives inside the provider.
 */
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { FarmModeProvider, useFarmMode } from "@/lib/farm-mode";

const STORAGE_KEY = (slug: string) => `farmtrack-mode-${slug}`;

function ModeProbe() {
  const { mode } = useFarmMode();
  return <div data-testid="mode">{mode}</div>;
}

beforeEach(() => {
  localStorage.clear();
  // Wipe any stale cookies from a prior test (best-effort under jsdom).
  document.cookie.split(";").forEach((c) => {
    const [name] = c.split("=");
    document.cookie = `${name.trim()}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
});

describe("FarmModeProvider — Bug 3 cross-farm species leak", () => {
  it("preserves each farm's stored mode when farmSlug changes on the same mounted provider", () => {
    // Pre-seed: user previously set sheep on farm-a, cattle on farm-b.
    localStorage.setItem(STORAGE_KEY("farm-a"), "sheep");
    localStorage.setItem(STORAGE_KEY("farm-b"), "cattle");

    const { rerender } = render(
      <FarmModeProvider farmSlug="farm-a" enabledSpecies={["cattle", "sheep"]}>
        <ModeProbe />
      </FarmModeProvider>,
    );

    // Step 1: provider on farm-a should reflect sheep.
    expect(screen.getByTestId("mode").textContent).toBe("sheep");

    // Step 2: re-render the SAME provider instance with farmSlug=farm-b.
    // (Next App Router preserves client providers across param changes.)
    act(() => {
      rerender(
        <FarmModeProvider farmSlug="farm-b" enabledSpecies={["cattle", "sheep"]}>
          <ModeProbe />
        </FarmModeProvider>,
      );
    });

    // Step 3: child must now see farm-b's stored mode (cattle), NOT the
    // sticky "sheep" from farm-a.
    expect(screen.getByTestId("mode").textContent).toBe("cattle");

    // Step 4: localStorage for farm-b must NOT have been overwritten with
    // "sheep" by the cookie-write effect.
    expect(localStorage.getItem(STORAGE_KEY("farm-b"))).toBe("cattle");

    // And farm-a's mode must still be intact.
    expect(localStorage.getItem(STORAGE_KEY("farm-a"))).toBe("sheep");
  });

  it("falls back to first enabled species when the new farm has no stored mode", () => {
    localStorage.setItem(STORAGE_KEY("farm-a"), "sheep");
    // farm-c has nothing in storage.

    const { rerender } = render(
      <FarmModeProvider farmSlug="farm-a" enabledSpecies={["cattle", "sheep"]}>
        <ModeProbe />
      </FarmModeProvider>,
    );
    expect(screen.getByTestId("mode").textContent).toBe("sheep");

    act(() => {
      rerender(
        <FarmModeProvider farmSlug="farm-c" enabledSpecies={["cattle", "sheep"]}>
          <ModeProbe />
        </FarmModeProvider>,
      );
    });

    // No stored value for farm-c → first enabled mode (cattle).
    expect(screen.getByTestId("mode").textContent).toBe("cattle");
  });
});
