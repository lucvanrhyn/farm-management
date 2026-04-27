// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

/**
 * Behaviour under test (P2 stress-test regression):
 *
 * The parent route `/subscribe` (NOT `/subscribe/complete`, which Phase B
 * fixed) currently calls `redirect('/login')` for any unauthenticated
 * visitor (see `app/subscribe/page.tsx` lines 17-19). Anonymous users who
 * follow marketing copy or share/bookmark the URL get bounced to a login
 * wall for an account they don't have — the original intent was to "see
 * plans and sign up".
 *
 * Phase B precedent: `/subscribe/complete` no longer hides actionable
 * outcomes behind a 24-second polling spinner; it fast-fails to a clear,
 * recoverable UI. The same principle applies here — anonymous users land
 * on a public plan picker that hands them off to `/register?tier=...`.
 *
 * Acceptance criteria:
 *   - Anonymous visit (no next-auth session) renders a public plan picker.
 *     No 307 to /login.
 *   - The picker exposes Basic, Advanced and Consulting tiers and links
 *     each to `/register?tier=basic|advanced|consulting`. This matches
 *     the marketing site CTA pattern (see farm-website-v2
 *     `lib/constants.ts` + `components/pricing/LsuPricingCalculator.tsx`).
 *   - Logged-in user with no farm slug fast-fails to `/farms`
 *     (preserved behaviour — semantics match `/subscribe/complete`).
 */

const redirectMock = vi.fn((target: string): never => {
  throw new Error(`__REDIRECT__:${target}`);
});

const getServerSessionMock = vi.fn();
const getFarmSubscriptionMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/auth-options", () => ({
  authOptions: {},
}));

vi.mock("@/lib/meta-db", () => ({
  getFarmSubscription: getFarmSubscriptionMock,
}));

vi.mock("@/lib/payfast", () => ({
  PAYFAST_URL: "https://sandbox.payfast.co.za/eng/process",
  buildSubscriptionParams: vi.fn(() => ({
    merchant_id: "test",
    item_name: "Basic",
  })),
  generateSignature: vi.fn(() => "test-sig"),
}));

beforeEach(() => {
  redirectMock.mockClear();
  getServerSessionMock.mockReset();
  getFarmSubscriptionMock.mockReset();
});

afterEach(() => {
  cleanup();
});

async function renderPage(searchParams: Record<string, string> = {}) {
  const mod = await import("@/app/subscribe/page");
  const Page = mod.default as (args: {
    searchParams: Promise<Record<string, string>>;
  }) => Promise<React.ReactElement>;
  const element = await Page({
    searchParams: Promise.resolve(searchParams),
  });
  return render(element);
}

describe("/subscribe — anonymous plan picker (P2 fast-fail)", () => {
  it("does not redirect anonymous visitors to /login", async () => {
    getServerSessionMock.mockResolvedValue(null);

    // Should not throw the __REDIRECT__ marker — page must render in-place.
    await renderPage();

    expect(redirectMock).not.toHaveBeenCalledWith("/login");
  });

  it("renders a public plan picker exposing Basic, Advanced and Consulting tiers", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const { container } = await renderPage();

    const text = container.textContent ?? "";
    expect(text).toMatch(/basic/i);
    expect(text).toMatch(/advanced/i);
    expect(text).toMatch(/consulting/i);
  });

  it("links each tier CTA to /register?tier=<slug> (marketing-site pattern)", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const { container } = await renderPage();

    const links = Array.from(container.querySelectorAll("a")).map(
      (a) => a.getAttribute("href") ?? "",
    );

    expect(links).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/register\?tier=basic/),
        expect.stringMatching(/\/register\?tier=advanced/),
        expect.stringMatching(/\/register\?tier=consulting/),
      ]),
    );
  });

  it("logged-in user with no resolvable farm fast-fails to /farms (no spinner trap)", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { email: "u@x.com", farms: [] },
    });

    await expect(renderPage()).rejects.toThrow("__REDIRECT__:/farms");
  });
});
