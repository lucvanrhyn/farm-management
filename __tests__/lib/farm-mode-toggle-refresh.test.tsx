// @vitest-environment jsdom
/**
 * wave/365 — Species toggle refreshes animal & camp data without a page reload.
 *
 * Issue #365: switching the FarmMode toggle (cattle ↔ sheep ↔ game) must
 * immediately refresh server-rendered, species-scoped data — "Total Animals"
 * on the admin overview, the camp/map data — with NO full page reload.
 *
 * Root cause locked by this test: server components (`DashboardContent`,
 * the admin/map pages) read the active species from the `farmtrack-mode-<slug>`
 * cookie. `FarmModeProvider.setMode()` writes that cookie but, before this
 * fix, did NOT invalidate the Next.js RSC/router cache. Only three specific
 * client consumers (`DashboardClient`, `AdminMapClient`, `TenantMapClient`)
 * carried their own `useEffect` mode-watcher that called `router.refresh()`.
 * The admin overview had no such watcher, so its cached RSC payload kept
 * serving the pre-toggle species count until a hard reload.
 *
 * Contract this test locks: a FarmMode toggle calls `router.refresh()`
 * exactly once, from inside the provider's `setMode` path — so EVERY
 * server-rendered page re-fetches with the new species cookie by
 * construction, with no full page reload (`router.refresh()` preserves the
 * client tree; it does not unmount or hard-navigate).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import React from "react";

import { ModeSwitcher } from "@/components/ui/ModeSwitcher";
import { FarmModeProvider } from "@/lib/farm-mode";

const refreshSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: refreshSpy,
  }),
  usePathname: () => "/farm-x/admin",
}));

// framer-motion's `layoutId` animation is irrelevant here — strip it to keep
// the DOM diff readable. Same pattern as mode-switcher-upsell.test.tsx.
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        const Component = (props: Record<string, unknown>) =>
          React.createElement(tag, props);
        Component.displayName = `motion.${tag}`;
        return Component;
      },
    },
  ),
}));

beforeEach(() => {
  cleanup();
  refreshSpy.mockClear();
  try {
    window.localStorage.clear();
  } catch {
    /* noop */
  }
  document.cookie.split(";").forEach((c) => {
    const [name] = c.split("=");
    document.cookie = `${name.trim()}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
});

function renderSwitcher(enabledSpecies: readonly string[]) {
  return render(
    <FarmModeProvider farmSlug="farm-x" enabledSpecies={enabledSpecies}>
      <ModeSwitcher variant="solid" />
    </FarmModeProvider>,
  );
}

describe("FarmMode toggle — RSC refresh (#365)", () => {
  it("calls router.refresh() when the user switches species", () => {
    renderSwitcher(["cattle", "sheep"]);

    // No refresh on initial mount — only an actual toggle should refresh.
    expect(refreshSpy).not.toHaveBeenCalled();

    const sheepPill = screen.getByRole("button", { name: /sheep/i });
    act(() => {
      fireEvent.click(sheepPill);
    });

    // The toggle must invalidate the RSC cache so server components
    // ("Total Animals", camp/map data) re-fetch with the new species cookie.
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("refreshes again on every subsequent toggle (cattle → sheep → cattle)", () => {
    renderSwitcher(["cattle", "sheep"]);

    const sheepPill = screen.getByRole("button", { name: /sheep/i });
    const cattlePill = screen.getByRole("button", { name: /cattle/i });

    act(() => {
      fireEvent.click(sheepPill);
    });
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    act(() => {
      fireEvent.click(cattlePill);
    });
    // Toggling back to cattle must ALSO refresh — this is the exact #365
    // repro ("after toggling back to cattle ... Total Animals stays 0").
    expect(refreshSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT refresh when the user clicks the already-active mode", () => {
    renderSwitcher(["cattle", "sheep"]);

    const cattlePill = screen.getByRole("button", { name: /cattle/i });
    // cattle is the default active mode — re-selecting it is a no-op and
    // must not burn an RSC re-fetch.
    act(() => {
      fireEvent.click(cattlePill);
    });
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});
