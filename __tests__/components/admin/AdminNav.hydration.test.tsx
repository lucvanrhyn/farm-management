// @vitest-environment jsdom
/**
 * Issue #387 — React #418 hydration mismatch on admin pages (AdminNav).
 *
 * Root cause: `AdminNav`'s `expanded` state was seeded by a lazy `useState`
 * initializer that called `readStoredExpanded(farmSlug)` — which reads
 * `localStorage` — on the very first client render.
 *
 * Server render:   `readStoredExpanded` returns `null` (no `window`) →
 *                  `expanded = new Set([activeGroupLabel])`.
 * Client 1st render: `readStoredExpanded` returns the stored `Set` whenever
 *                  the user had previously toggled a group →
 *                  `expanded` differs from the server value.
 *
 * Because each group's collapsible panel is STRUCTURALLY gated with
 * `{isOpen && <motion.div>...</motion.div>}`, a different `expanded` set
 * mounts a different set of `<motion.div>` nodes → structural DOM divergence
 * → React #418 hydration mismatch.
 *
 * Fix: initializer produces the same value as the server (`new Set([activeGroupLabel])`),
 * and the persisted preference is applied AFTER mount inside a `useEffect`
 * (using `queueMicrotask` per the repo's no-sync-setState-in-effect rule).
 *
 * Locked invariant: AdminNav's first (pre-effect) render is identical whether
 * `localStorage` is empty or populated with a non-default expansion preference.
 *
 * Technique: `renderToString` captures exactly the pre-effect render, so two
 * calls — one with empty storage, one with a non-default stored preference —
 * must produce byte-for-byte identical HTML.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

// ─── Mocks identical to AdminNav.test.tsx ───────────────────────────────────
// These are module-level so they survive across tests in this file.

vi.mock("next/navigation", () => ({
  usePathname: () => "/farm-x/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

vi.mock("@/components/admin/NotificationBell", () => ({
  default: () => React.createElement("div", { "data-testid": "notification-bell" }),
}));

vi.mock("@/components/logger/SignOutButton", () => ({
  SignOutButton: () => React.createElement("div", { "data-testid": "sign-out-button" }),
}));

vi.mock("@/components/ui/ModeSwitcher", () => ({
  ModeSwitcher: () => React.createElement("div", { "data-testid": "mode-switcher" }),
}));

vi.mock("@/lib/farm-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/farm-mode")>();
  return {
    ...actual,
    useFarmModeSafe: () => ({
      mode: "cattle" as const,
      setMode: () => {},
      enabledModes: ["cattle", "sheep", "game"] as readonly ("cattle" | "sheep" | "game")[],
      isMultiMode: true,
      hasMultipleSpecies: true,
    }),
  };
});

import AdminNav from "@/components/admin/AdminNav";

// The localStorage key used by AdminNav for /farm-x farm slug.
const STORAGE_KEY = "farmtrack-nav-expanded-farm-x";

afterEach(() => {
  // Clear localStorage between tests to avoid cross-contamination.
  try {
    window.localStorage.clear();
  } catch {
    // noop
  }
});

describe("AdminNav — hydration parity (#387)", () => {
  it("first render is identical whether localStorage is empty or has a non-default expansion (no #418)", () => {
    // ── Render 1: empty storage (simulates server / fresh session) ──────────
    try {
      window.localStorage.clear();
    } catch {
      // noop
    }
    const serverEquivalent = renderToString(
      React.createElement(AdminNav, { tier: "advanced" }),
    );

    // ── Render 2: storage has non-default preference ──────────────────────
    // Store ["Finance", "Compliance"] — a set that differs from the default
    // ["Overview"] that the server would render. Under the buggy initializer
    // the second renderToString would produce different HTML because the
    // initializer reads localStorage synchronously.
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["Finance", "Compliance"]));
    } catch {
      // noop
    }
    const clientFirstRender = renderToString(
      React.createElement(AdminNav, { tier: "advanced" }),
    );

    // Hydration parity: server render === client first render.
    // renderToString does NOT run useEffect, so this captures the pre-effect
    // state — exactly the snapshot React uses to compare against the server HTML.
    expect(clientFirstRender).toBe(serverEquivalent);
  });
});
