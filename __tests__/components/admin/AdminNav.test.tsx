// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// ─── Mocks ──────────────────────────────────────────────────────────────────
// usePathname is mutated per-test; stubs below read this variable at call-time.
let mockPathname = "/farm-x/admin";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

// NotificationBell hits /api/notifications on mount — stub it out.
vi.mock("@/components/admin/NotificationBell", () => ({
  default: () => <div data-testid="notification-bell" />,
}));

// SignOutButton uses useRouter which is already mocked — but stub anyway
// for deterministic, lightweight DOM.
vi.mock("@/components/logger/SignOutButton", () => ({
  SignOutButton: () => <div data-testid="sign-out-button" />,
}));

// ModeSwitcher depends on useFarmMode (a strict throw). Mock for test isolation.
vi.mock("@/components/ui/ModeSwitcher", () => ({
  ModeSwitcher: () => <div data-testid="mode-switcher" />,
}));

// Directly control the farm-mode hook so tests can pin any mode independently
// of the FarmModeProvider's enabled-mode expansion rules.
let mockMode: "cattle" | "sheep" | "game" = "cattle";
let mockEnabledModes: readonly ("cattle" | "sheep" | "game")[] = [
  "cattle",
  "sheep",
  "game",
];
vi.mock("@/lib/farm-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/farm-mode")>();
  return {
    ...actual,
    useFarmModeSafe: () => ({
      mode: mockMode,
      setMode: () => {},
      enabledModes: mockEnabledModes,
      isMultiMode: mockEnabledModes.length > 1,
      hasMultipleSpecies: mockEnabledModes.length > 1,
    }),
  };
});

// Framer-motion's animations are irrelevant; no mock needed — it works fine
// in jsdom for static renders.

import AdminNav from "@/components/admin/AdminNav";

type FarmMode = "cattle" | "sheep" | "game";

function renderNav({
  pathname,
  enabledSpecies,
  mode = "cattle",
  enabledModes,
}: {
  pathname: string;
  enabledSpecies?: string[];
  mode?: FarmMode;
  /** Override the FarmModeProvider's enabledModes (drives single-vs-multi
   * species chrome). Defaults to all three so legacy tests keep their
   * pre-#263 multi-species posture. */
  enabledModes?: readonly FarmMode[];
}) {
  mockPathname = pathname;
  mockMode = mode;
  mockEnabledModes = enabledModes ?? ["cattle", "sheep", "game"];
  return render(<AdminNav tier="advanced" enabledSpecies={enabledSpecies} />);
}

function normalize(s: string | null): string {
  // jsdom reformats rgba() with spaces; strip spaces for stable assertions.
  return (s ?? "").replace(/\s+/g, "");
}

function getLink(label: string): HTMLElement | null {
  const links = screen.queryAllByRole("link", { name: new RegExp(`^${label}$`, "i") });
  return links[0] ?? null;
}

describe("AdminNav", () => {
  beforeEach(() => {
    cleanup();
  });

  // ─── N1: sub-route active state ──────────────────────────────────────────

  describe("N1 — sub-route active state for sheep/game", () => {
    it("marks a sheep-scoped nav item active when pathname is under /<farmSlug>/sheep/...", () => {
      renderNav({ pathname: "/farm-x/sheep/animals", mode: "sheep" });

      // "Lambing" is a sheep-scoped item at /sheep/reproduction.
      // On ANY /farm-x/sheep/* sub-route, the sheep anchor item should be active.
      const lambing = getLink("Lambing");
      expect(lambing).not.toBeNull();
      // Active styling: the background carries the amber-tint rgba.
      expect(normalize(lambing!.getAttribute("style"))).toContain("rgba(139,105,20,0.14)");
    });

    it("marks a game-scoped nav item active when pathname is under /<farmSlug>/game/...", () => {
      renderNav({ pathname: "/farm-x/game/camps", mode: "game" });

      // "Census" at /game/census is a game-scoped anchor item.
      const census = getLink("Census");
      expect(census).not.toBeNull();
      expect(normalize(census!.getAttribute("style"))).toContain("rgba(139,105,20,0.14)");
    });

    it("does NOT mark sheep items active when pathname is /<farmSlug>/admin", () => {
      renderNav({ pathname: "/farm-x/admin", mode: "sheep" });

      const lambing = getLink("Lambing");
      expect(lambing).not.toBeNull();
      // Active background should be absent — only Overview (/admin) should be active.
      expect(normalize(lambing!.getAttribute("style"))).not.toContain("rgba(139,105,20,0.14)");
    });
  });

  // ─── N2: per-mode item filtering ─────────────────────────────────────────

  describe("N2 — filter nav items by enabledSpecies", () => {
    it("hides sheep-specific items when enabledSpecies excludes 'sheep'", () => {
      // Force sheep mode in nav; with enabledSpecies=['cattle'], sheep-tagged
      // items should be filtered out even though the sheep nav set is active.
      renderNav({
        pathname: "/farm-x/admin",
        enabledSpecies: ["cattle"],
        mode: "sheep",
      });

      // "Lambing" is tagged species: "sheep" and must be filtered out.
      expect(getLink("Lambing")).toBeNull();
    });

    it("hides game-specific items when enabledSpecies excludes 'game'", () => {
      renderNav({
        pathname: "/farm-x/admin",
        enabledSpecies: ["cattle"],
        mode: "game",
      });

      // Game-only items (Census, Hunting) must be filtered out.
      expect(getLink("Census")).toBeNull();
      expect(getLink("Hunting")).toBeNull();
    });

    it("renders sheep items when enabledSpecies includes 'sheep'", () => {
      renderNav({
        pathname: "/farm-x/admin",
        enabledSpecies: ["cattle", "sheep"],
        mode: "sheep",
      });

      expect(getLink("Lambing")).not.toBeNull();
    });

    it("renders all items when enabledSpecies is undefined (defensive fallback)", () => {
      renderNav({
        pathname: "/farm-x/admin",
        enabledSpecies: undefined,
        mode: "sheep",
      });

      expect(getLink("Lambing")).not.toBeNull();
    });

    it("always renders cattle (shared) items regardless of enabledSpecies", () => {
      renderNav({
        pathname: "/farm-x/admin",
        enabledSpecies: ["cattle"],
        mode: "cattle",
      });

      // Overview is a shared/cattle item — should always be present.
      expect(getLink("Overview")).not.toBeNull();
    });
  });

  // ─── I8: collapsible accordion groups ────────────────────────────────────

  describe("I8 — accordion groups", () => {
    beforeEach(() => {
      try {
        window.localStorage.removeItem("farmtrack-nav-expanded-farm-x");
      } catch {
        // noop — some jsdom builds ship a read-only store
      }
    });

    it("renders every required group header", () => {
      renderNav({ pathname: "/farm-x/admin", mode: "cattle" });
      const expected = [
        "Overview",
        "Animals",
        "Breeding",
        "Camps & Grazing",
        "Finance",
        "Compliance",
        "Today",
      ];
      for (const label of expected) {
        expect(
          screen.queryByRole("button", { name: new RegExp(`^${label}$`, "i") }),
        ).not.toBeNull();
      }
    });

    it("auto-expands the group containing the active route (Overview at /admin)", () => {
      renderNav({ pathname: "/farm-x/admin", mode: "cattle" });
      const header = screen.getByRole("button", { name: /^Overview$/i });
      expect(header.getAttribute("aria-expanded")).toBe("true");
    });

    it("auto-expands Breeding when on /admin/reproduction", () => {
      renderNav({ pathname: "/farm-x/admin/reproduction", mode: "cattle" });
      const breedingHeader = screen.getByRole("button", { name: /^Breeding$/i });
      expect(breedingHeader.getAttribute("aria-expanded")).toBe("true");
      // Non-active groups stay collapsed by default.
      const financeHeader = screen.getByRole("button", { name: /^Finance$/i });
      expect(financeHeader.getAttribute("aria-expanded")).toBe("false");
    });

    it("persists expanded set to localStorage when a group is opened", () => {
      renderNav({ pathname: "/farm-x/admin", mode: "cattle" });
      const financeHeader = screen.getByRole("button", { name: /^Finance$/i });

      // Open Finance
      financeHeader.click();

      const raw = window.localStorage.getItem("farmtrack-nav-expanded-farm-x");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed).toContain("Finance");
    });

    it("restores expanded groups from localStorage on mount", () => {
      window.localStorage.setItem(
        "farmtrack-nav-expanded-farm-x",
        JSON.stringify(["Finance", "Compliance"]),
      );
      renderNav({ pathname: "/farm-x/admin", mode: "cattle" });
      expect(
        screen.getByRole("button", { name: /^Finance$/i }).getAttribute("aria-expanded"),
      ).toBe("true");
      expect(
        screen.getByRole("button", { name: /^Compliance$/i }).getAttribute("aria-expanded"),
      ).toBe("true");
    });

    it("refuses to collapse the group containing the active route", () => {
      renderNav({ pathname: "/farm-x/admin/reproduction", mode: "cattle" });
      const breedingHeader = screen.getByRole("button", { name: /^Breeding$/i });
      expect(breedingHeader.getAttribute("aria-expanded")).toBe("true");

      // User clicks to collapse — but this group holds the active item, so
      // we keep it open to preserve orientation.
      breedingHeader.click();
      expect(breedingHeader.getAttribute("aria-expanded")).toBe("true");
    });
  });

  // ─── #263: Species settings nav link visibility ──────────────────────────
  //
  // The "Species" link points at /admin/settings/species which only does
  // anything useful for tenants that actually have multiple species
  // configured (Trio B). For single-species tenants (Basson) it surfaces
  // the disabled "Add species" CTA that the user explicitly asked to
  // remove. After #263 the nav link itself is hidden when the tenant has
  // exactly one enabled species.
  describe("#263 — Species settings link visibility", () => {
    it("renders the Species nav link on a multi-species tenant (Trio B: cattle + sheep)", () => {
      renderNav({
        pathname: "/farm-x/admin",
        mode: "cattle",
        enabledModes: ["cattle", "sheep"],
        enabledSpecies: ["cattle", "sheep"],
      });
      expect(getLink("Species")).not.toBeNull();
    });

    it("does NOT render the Species nav link on a single-species tenant (Basson: cattle-only)", () => {
      renderNav({
        pathname: "/farm-x/admin",
        mode: "cattle",
        enabledModes: ["cattle"],
        enabledSpecies: ["cattle"],
      });
      expect(getLink("Species")).toBeNull();
    });

    it("does NOT render the Species nav link on a sheep-only tenant (defence in depth)", () => {
      renderNav({
        pathname: "/farm-x/admin",
        mode: "sheep",
        enabledModes: ["sheep"],
        enabledSpecies: ["sheep"],
      });
      expect(getLink("Species")).toBeNull();
    });
  });
});
