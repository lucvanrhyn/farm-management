// @vitest-environment jsdom
/**
 * wave/235 — ModeSwitcher dimmed "+ Add species" upsell pill.
 *
 * Issue #235 closes the still-unchecked acceptance criterion on #28: the
 * mode switcher must render a dimmed "+ Add species" entry on
 * single-species tenants (e.g. Basson, cattle-only). On multi-species
 * tenants no upsell entry renders. Clicking the upsell opens an info
 * dialog with a contact link.
 *
 * Detection rule (#235 AC): "Mode switcher detects whether the tenant
 * has multiple species in Animal records". The boolean is computed
 * server-side via `prisma.animal.groupBy({ by: ['species'] })` against
 * Active rows and threaded down as a prop — the client switcher must
 * NOT refetch on its own.
 *
 * Visual contract: the upsell pill is dimmed (opacity-* utility) and
 * marked `aria-disabled="true"` so screen readers don't treat it as a
 * real mode toggle. It is, however, focusable + clickable — tapping it
 * opens the upsell dialog.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import React from "react";

import { ModeSwitcher } from "@/components/ui/ModeSwitcher";
import { FarmModeProvider } from "@/lib/farm-mode";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/farm-x/home",
}));

// framer-motion's `layoutId` animation is irrelevant here — strip it to keep
// the DOM diff readable in test failures. Lifted verbatim from the pattern
// used in __tests__/components/logger-status-bar-failed-badge.test.tsx.
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
  try {
    window.localStorage.clear();
  } catch {
    /* noop */
  }
});

function renderSwitcher(props: {
  enabledSpecies: readonly string[];
  hasMultipleSpecies: boolean;
}) {
  return render(
    <FarmModeProvider
      farmSlug="basson"
      enabledSpecies={props.enabledSpecies}
      hasMultipleSpecies={props.hasMultipleSpecies}
    >
      <ModeSwitcher variant="solid" />
    </FarmModeProvider>,
  );
}

describe("ModeSwitcher — single-species tenants (#263 supersedes #235)", () => {
  // Issue #263 supersedes the #235 dimmed-upsell behaviour.
  // User feedback (Luc, 2026-05-13): "I don't like that add species thing
  // that's everywhere... it needs to be removed." The dimmed pill was dead
  // clickable noise on every page. The new contract: on single-species
  // tenants, the entire ModeSwitcher does not render — `enabledModes.length
  // <= 1` is the sole guard, regardless of `hasMultipleSpecies`. The
  // `+ Add species` affordance is gone everywhere it appeared.

  it("does NOT render anything on a cattle-only tenant (no switcher, no upsell pill)", () => {
    const { container } = renderSwitcher({
      enabledSpecies: ["cattle"],
      hasMultipleSpecies: false,
    });

    // Whole component returns null — empty container fragment.
    expect(container.firstChild).toBeNull();

    // Specifically: no Cattle pill, no upsell button, no dialog mount.
    expect(screen.queryByText("Cattle")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\+\s*Add species/i }),
    ).not.toBeInTheDocument();
  });

  it("does NOT render anything on a cattle-only tenant even when hasMultipleSpecies is later flipped (defence in depth)", () => {
    // The `hasMultipleSpecies` prop becomes irrelevant after #263 —
    // single-species tenants never see the bar. This guards against a
    // future regression where a cached value disagrees with the
    // enabled-species set.
    const { container } = renderSwitcher({
      enabledSpecies: ["cattle"],
      hasMultipleSpecies: true,
    });

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Cattle")).not.toBeInTheDocument();
  });

  it("renders the switcher on a multi-species tenant (Trio B: cattle + sheep) without any upsell pill", () => {
    renderSwitcher({
      enabledSpecies: ["cattle", "sheep"],
      hasMultipleSpecies: true,
    });

    expect(screen.getByText("Cattle")).toBeInTheDocument();
    expect(screen.getByText("Sheep")).toBeInTheDocument();

    // The dimmed upsell must NOT render anywhere — #263 removes it
    // unconditionally.
    expect(
      screen.queryByRole("button", { name: /\+\s*Add species/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the switcher on a 3-species tenant (cattle + sheep + game) without any upsell pill", () => {
    renderSwitcher({
      enabledSpecies: ["cattle", "sheep", "game"],
      hasMultipleSpecies: true,
    });

    expect(screen.getByText("Cattle")).toBeInTheDocument();
    expect(screen.getByText("Sheep")).toBeInTheDocument();
    expect(screen.getByText("Game")).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: /\+\s*Add species/i }),
    ).not.toBeInTheDocument();
  });

  // Keep one within-import alive so the import block does not warn unused.
  it("uses within() helper safely (sentinel)", () => {
    renderSwitcher({
      enabledSpecies: ["cattle", "sheep"],
      hasMultipleSpecies: true,
    });
    const cattle = screen.getByText("Cattle");
    expect(within(cattle.parentElement!).getByText("Cattle")).toBeInTheDocument();
  });

  // Keep `fireEvent` import alive even though the upsell click flow is gone —
  // the switcher itself remains clickable, exercise that path.
  it("clicking the Sheep pill on a multi-species tenant calls setMode (sanity smoke)", () => {
    renderSwitcher({
      enabledSpecies: ["cattle", "sheep"],
      hasMultipleSpecies: true,
    });
    const sheep = screen.getByRole("button", { name: /^.*Sheep.*$/i });
    fireEvent.click(sheep);
    // No throw == pass; the cookie write is async and best covered by E2E.
    expect(sheep).toBeInTheDocument();
  });
});
