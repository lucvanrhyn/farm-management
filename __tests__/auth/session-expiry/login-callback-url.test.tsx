// @vitest-environment jsdom
/**
 * P1.6 — login page honours `?callbackUrl=` (next-auth convention) as a
 * synonym for `?next=` so the session-expiry banner can use the standard
 * next-auth signIn() flow and have the user land back on their original
 * page after re-authenticating.
 *
 * `next=` still wins if both query params are present (existing proxy.ts
 * deep-link convention). Both flow through getSafeNext() so neither bypasses
 * the open-redirect filter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  fetch: vi.fn(),
  assign: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mocks.signIn(...args),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useSearchParams: () => mocks.searchParams,
  };
});

beforeEach(() => {
  mocks.signIn.mockReset();
  mocks.fetch.mockReset();
  mocks.assign.mockReset();
  globalThis.fetch = mocks.fetch as unknown as typeof fetch;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: mocks.assign },
  });
});

afterEach(() => cleanup());

async function loadLoginPage() {
  const mod = await import("@/app/(auth)/login/page");
  return mod.default;
}

async function submitValidCreds() {
  mocks.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  });
  mocks.signIn.mockResolvedValue({ ok: true, error: null });

  fireEvent.change(screen.getByLabelText(/^username$/i), {
    target: { value: "user" },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "pw" },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("login callback url", () => {
  it("redirects to ?callbackUrl after a successful sign-in", async () => {
    mocks.searchParams = new URLSearchParams("callbackUrl=/myfarm/admin/animals");
    const LoginPage = await loadLoginPage();
    render(<LoginPage />);

    await submitValidCreds();

    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith("/myfarm/admin/animals"),
    );
  });

  it("prefers `next=` when both `next=` and `callbackUrl=` are present", async () => {
    mocks.searchParams = new URLSearchParams(
      "next=/myfarm/logger&callbackUrl=/farms",
    );
    const LoginPage = await loadLoginPage();
    render(<LoginPage />);

    await submitValidCreds();

    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("/myfarm/logger"));
  });

  it("rejects open-redirect attempts in callbackUrl", async () => {
    mocks.searchParams = new URLSearchParams("callbackUrl=//evil.example/oops");
    const LoginPage = await loadLoginPage();
    render(<LoginPage />);

    await submitValidCreds();

    // Falls back to /farms because getSafeNext() rejects protocol-relative URLs.
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("/farms"));
  });
});
