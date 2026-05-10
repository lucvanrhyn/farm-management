// @vitest-environment jsdom
/**
 * P1.6 — SessionExpiryBanner component
 *
 * Behaviour pinned by this spec:
 *  - Renders nothing when the session is healthy (not expired, not expiring soon).
 *  - Renders nothing when the route is the login/register/verify-email page —
 *    we never want the banner on auth screens themselves.
 *  - Renders a warning banner ("Your session is about to expire") with a
 *    "Stay signed in" action when isExpiringSoon=true.
 *  - Renders a blocking banner ("Your session has expired") with a
 *    "Sign in again" action when isExpired=true.
 *  - The "Sign in again" action calls signIn() with `callbackUrl` set to the
 *    CURRENT pathname + search so the user lands back on their page after
 *    re-auth. Acceptance criteria #2 — return-to-page after re-auth.
 *  - The "Stay signed in" action calls useSession().update() to refresh the
 *    JWT without leaving the page (next-auth supports this; the jwt callback
 *    re-reads farms on `trigger === "update"`).
 *  - role="alert" + aria-live="assertive" on the expired variant so screen
 *    readers announce immediately. role="status" + aria-live="polite" on the
 *    soon-to-expire variant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  useSessionExpiry: vi.fn(),
  signIn: vi.fn(),
  update: vi.fn(),
  pathname: "/farms",
  searchParams: new URLSearchParams(),
}));

vi.mock("@/lib/auth/use-session-expiry", () => ({
  useSessionExpiry: () => mocks.useSessionExpiry(),
}));

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mocks.signIn(...args),
  useSession: () => ({ update: mocks.update }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.searchParams,
}));

beforeEach(() => {
  mocks.useSessionExpiry.mockReset();
  mocks.signIn.mockReset();
  mocks.update.mockReset();
  mocks.pathname = "/farms";
  mocks.searchParams = new URLSearchParams();
});

afterEach(() => cleanup());

async function loadBanner() {
  const mod = await import("@/components/auth/SessionExpiryBanner");
  return mod.SessionExpiryBanner;
}

describe("SessionExpiryBanner", () => {
  it("renders nothing while the session is healthy", async () => {
    mocks.useSessionExpiry.mockReturnValue({
      status: "authenticated",
      isExpired: false,
      isExpiringSoon: false,
      timeRemainingMs: 30 * 60_000,
      expiresAt: new Date(),
    });
    const Banner = await loadBanner();
    const { container } = render(<Banner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the session status is loading", async () => {
    mocks.useSessionExpiry.mockReturnValue({
      status: "loading",
      isExpired: false,
      isExpiringSoon: false,
      timeRemainingMs: null,
      expiresAt: null,
    });
    const Banner = await loadBanner();
    const { container } = render(<Banner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing on /login (auth route)", async () => {
    mocks.pathname = "/login";
    mocks.useSessionExpiry.mockReturnValue({
      status: "unauthenticated",
      isExpired: true,
      isExpiringSoon: false,
      timeRemainingMs: 0,
      expiresAt: new Date(),
    });
    const Banner = await loadBanner();
    const { container } = render(<Banner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the expiring-soon variant with role=status", async () => {
    mocks.useSessionExpiry.mockReturnValue({
      status: "authenticated",
      isExpired: false,
      isExpiringSoon: true,
      timeRemainingMs: 30_000,
      expiresAt: new Date(),
    });
    const Banner = await loadBanner();
    render(<Banner />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/session.*expire/i);
    expect(screen.getByRole("button", { name: /stay signed in/i })).toBeInTheDocument();
  });

  it("renders the expired variant with role=alert", async () => {
    mocks.useSessionExpiry.mockReturnValue({
      status: "unauthenticated",
      isExpired: true,
      isExpiringSoon: false,
      timeRemainingMs: 0,
      expiresAt: new Date(),
    });
    const Banner = await loadBanner();
    render(<Banner />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/session.*expired/i);
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
  });

  it("Sign in again passes current pathname + search to signIn callbackUrl", async () => {
    mocks.pathname = "/myfarm/admin/animals";
    mocks.searchParams = new URLSearchParams("page=2&q=tag");
    mocks.useSessionExpiry.mockReturnValue({
      status: "unauthenticated",
      isExpired: true,
      isExpiringSoon: false,
      timeRemainingMs: 0,
      expiresAt: new Date(),
    });
    const Banner = await loadBanner();
    render(<Banner />);

    fireEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    const [provider, opts] = mocks.signIn.mock.calls[0];
    expect(provider).toBeUndefined();
    expect(opts).toMatchObject({
      callbackUrl: "/myfarm/admin/animals?page=2&q=tag",
    });
  });

  it("Sign in again on a path with no search omits the trailing ?", async () => {
    mocks.pathname = "/farms";
    mocks.searchParams = new URLSearchParams();
    mocks.useSessionExpiry.mockReturnValue({
      status: "unauthenticated",
      isExpired: true,
      isExpiringSoon: false,
      timeRemainingMs: 0,
      expiresAt: new Date(),
    });
    const Banner = await loadBanner();
    render(<Banner />);

    fireEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    expect(mocks.signIn).toHaveBeenCalledWith(undefined, { callbackUrl: "/farms" });
  });

  it("Stay signed in calls useSession().update() to refresh the JWT", async () => {
    mocks.useSessionExpiry.mockReturnValue({
      status: "authenticated",
      isExpired: false,
      isExpiringSoon: true,
      timeRemainingMs: 30_000,
      expiresAt: new Date(),
    });
    mocks.update.mockResolvedValue({});
    const Banner = await loadBanner();
    render(<Banner />);

    fireEvent.click(screen.getByRole("button", { name: /stay signed in/i }));

    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
