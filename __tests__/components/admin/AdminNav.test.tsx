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
vi.mock("@/lib/farm-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/farm-mode")>();
  return {
    ...actual,
    useFarmModeSafe: () => ({
      mode: mockMode,
      setMode: () => {},
      enabledModes: ["cattle", "sheep", "game"] as const,
      isMultiMode: true,
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
}: {
  pathname: string;
  enabledSpecies?: string[];
  mode?: FarmMode;
}) {
  mockPathname = pathname;
  mockMode = mode;
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

});
