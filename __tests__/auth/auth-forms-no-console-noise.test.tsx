// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";

/**
 * Phase A4 + A5 — failed-auth flows must not emit `console.error` events.
 *
 * Why this matters: every Sentry/Vercel monitor that listens to client
 * console events sees a non-actionable event for each bad-creds login or
 * each expired-token verification resend. The form already renders a
 * user-facing message, so the duplicate console output is pure noise.
 *
 * Root-cause invariant: the page-level fetch wrappers must consume the
 * non-2xx response (read the JSON, set the UI error state) without
 * routing the failure through a logger that hits `console.error`.
 *
 * NOTE: this test only audits OUR code's contribution to console.error.
 * NextAuth's internal `fetch` to /api/auth/callback/credentials returns a
 * 401 that the browser may flag in DevTools' network panel, but that is
 * not a `console.error` call and Playwright's `page.on('console')` does
 * not pick it up — so the user-visible noise we own is everything that
 * runs on `window.console.error`.
 */

const signInMock = vi.fn();

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

// Visual audit P1 (2026-05-04): the login page now reads `?next=` via
// useSearchParams() and sanitises through getSafeNext(). Outside a real
// Next runtime the hook returns null, so stub a default URLSearchParams.
// The verify-email block below uses vi.doMock to override per-test, which
// composes correctly with this top-level vi.mock baseline.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useSearchParams: () => new URLSearchParams(),
  };
});

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signInMock.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  cleanup();
});

describe("login bad-creds — emits zero console.error events", () => {
  it("does not call console.error when /api/auth/login-check returns 200+{ok:false}", async () => {
    // P1 — the login page now pre-flights `/api/auth/login-check` BEFORE
    // calling signIn(). The pre-flight always returns HTTP 200 with a typed
    // payload, so the browser never auto-emits a 401 to the network log and
    // the form's error-handling path never invokes console.error.
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, reason: "INVALID_CREDENTIALS" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email or username/i), {
      target: { value: "wrong@user.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    // Wait for the user-facing error copy so we know the failed-creds
    // path completed before checking the spy.
    await waitFor(() =>
      expect(
        screen.getByText(/incorrect email\/username or password/i),
      ).toBeInTheDocument(),
    );

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    // signIn() must NOT be called when the pre-flight rejects — that's the
    // whole point of the new route (it would re-introduce the 401 noise).
    expect(signInMock).not.toHaveBeenCalled();
  });
});

describe("verify-email resend with invalid token — emits zero console.error events", () => {
  it("does not call console.error when /api/auth/resend-verification returns 400", async () => {
    // Mock fetch sequence:
    //  1. initial verify-email fetch (token=bad) → 400 (server says invalid)
    //  2. resend-verification POST → 400 (server says e.g. malformed email)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "Invalid or expired verification link." }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "Invalid email." }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Stub useSearchParams so the page sees a token and runs the verify path.
    vi.doMock("next/navigation", async (importOriginal) => {
      const actual = await importOriginal<typeof import("next/navigation")>();
      return {
        ...actual,
        useSearchParams: () => ({ get: () => "bad-token" }),
      };
    });

    const { default: VerifyEmailPage } = await import(
      "@/app/(auth)/verify-email/page"
    );
    render(<VerifyEmailPage />);

    // Wait for the error panel (initial verify failed → ErrorPanel renders).
    await waitFor(() =>
      expect(
        screen.getByText(/verification failed/i),
      ).toBeInTheDocument(),
    );

    // Now resend: fill the email + click "Resend verification email".
    const emailInput = screen.getByPlaceholderText(/you@example/i);
    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.click(
      screen.getByRole("button", { name: /resend verification email/i }),
    );

    // Wait for the surfaced error copy from the 400 response.
    await waitFor(() =>
      expect(screen.getByText(/invalid email\./i)).toBeInTheDocument(),
    );

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    vi.doUnmock("next/navigation");
  });
});
