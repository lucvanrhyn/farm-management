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

describe("ModeSwitcher — single-species upsell pill (#235)", () => {
  it("renders ONLY the Cattle pill plus the dimmed '+ Add species' upsell on a cattle-only tenant", () => {
    renderSwitcher({
      enabledSpecies: ["cattle"],
      hasMultipleSpecies: false,
    });

    expect(screen.getByText("Cattle")).toBeInTheDocument();

    // Upsell entry is present with the canonical copy.
    const upsell = screen.getByRole("button", { name: /\+\s*Add species/i });
    expect(upsell).toBeInTheDocument();

    // Visually dimmed (className contains opacity-*) AND semantically
    // disabled (aria-disabled=true) so AT users don't perceive it as
    // an actionable mode-toggle.
    expect(upsell.className).toMatch(/opacity-/);
    expect(upsell).toHaveAttribute("aria-disabled", "true");

    // Sheep / Game are NOT rendered as mode pills on a cattle-only farm.
    expect(screen.queryByText("Sheep")).not.toBeInTheDocument();
    expect(screen.queryByText("Game")).not.toBeInTheDocument();
  });

  it("does NOT render an upsell entry on a multi-species tenant (Trio B: cattle + sheep)", () => {
    renderSwitcher({
      enabledSpecies: ["cattle", "sheep"],
      hasMultipleSpecies: true,
    });

    expect(screen.getByText("Cattle")).toBeInTheDocument();
    expect(screen.getByText("Sheep")).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: /\+\s*Add species/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the upsell dialog when the dimmed pill is clicked", () => {
    renderSwitcher({
      enabledSpecies: ["cattle"],
      hasMultipleSpecies: false,
    });

    // Dialog is not in the DOM before the click.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /\+\s*Add species/i }),
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Dialog explains the upsell + offers a contact path. The exact wording
    // is allowed to evolve; we assert the user-facing intent (more species)
    // and the presence of a contact affordance.
    expect(
      within(dialog).getByText(/add another species/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: /contact/i }),
    ).toBeInTheDocument();
  });

  it("does not render the bar at all when there is exactly one enabled species AND no upsell to show", () => {
    // Sanity check: pre-#235 behaviour was `enabledModes.length <= 1` → null.
    // After #235 that early-return is gated on the `hasMultipleSpecies` prop
    // — when the tenant is genuinely single-species we render the upsell, so
    // the bar appears. The "null when single-mode" return path must remain
    // available for surfaces that opt out of the upsell (logger, admin nav
    // where it adds clutter) by passing `hasMultipleSpecies={true}` even on
    // a cattle-only farm — that surface still gets no bar.
    renderSwitcher({
      enabledSpecies: ["cattle"],
      hasMultipleSpecies: true,
    });

    expect(screen.queryByText("Cattle")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\+\s*Add species/i }),
    ).not.toBeInTheDocument();
  });
});
