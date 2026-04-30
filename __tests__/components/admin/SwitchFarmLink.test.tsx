// @vitest-environment jsdom
/**
 * F6 — Back-to-farm-selector link in AdminNav
 *
 * Tests:
 *  - When farmCount = 1 → "Switch farm" link is NOT rendered
 *  - When farmCount = 2 → "Switch farm" link IS rendered
 *  - When farmCount = 3 → "Switch farm" link IS rendered
 *  - The link href points to /farms (the farm selector)
 *
 * Uses RTL + AdminNav with a farmCount prop. Auth is not required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

let mockPathname = "/farm-x/admin";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

vi.mock("@/components/admin/NotificationBell", () => ({
  default: () => <div data-testid="notification-bell" />,
}));

vi.mock("@/components/logger/SignOutButton", () => ({
  SignOutButton: () => <div data-testid="sign-out-button" />,
}));

vi.mock("@/components/ui/ModeSwitcher", () => ({
  ModeSwitcher: () => <div data-testid="mode-switcher" />,
}));

vi.mock("@/lib/farm-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/farm-mode")>();
  return {
    ...actual,
    useFarmModeSafe: () => ({
      mode: "cattle",
      setMode: () => {},
      enabledModes: ["cattle"] as const,
      isMultiMode: false,
    }),
  };
});

import AdminNav from "@/components/admin/AdminNav";

function renderNav(farmCount: number) {
  mockPathname = "/farm-x/admin";
  return render(
    <AdminNav tier="basic" enabledSpecies={["cattle"]} farmCount={farmCount} />,
  );
}

describe("F6 — Switch farm link in AdminNav", () => {
  beforeEach(() => {
    cleanup();
    try {
      window.localStorage.removeItem("farmtrack-nav-expanded-farm-x");
    } catch {
      // noop
    }
  });

  it("does NOT render '← Switch farm' when farmCount is 1", () => {
    renderNav(1);
    const link = screen.queryByRole("link", { name: /switch farm/i });
    expect(link).toBeNull();
  });

  it("renders '← Switch farm' link when farmCount is 2", () => {
    renderNav(2);
    const link = screen.queryByRole("link", { name: /switch farm/i });
    expect(link).not.toBeNull();
  });

  it("renders '← Switch farm' link when farmCount is 3", () => {
    renderNav(3);
    const link = screen.queryByRole("link", { name: /switch farm/i });
    expect(link).not.toBeNull();
  });

  it("'← Switch farm' link href points to /farms", () => {
    renderNav(2);
    const link = screen.getByRole("link", { name: /switch farm/i });
    expect(link.getAttribute("href")).toBe("/farms");
  });
});
