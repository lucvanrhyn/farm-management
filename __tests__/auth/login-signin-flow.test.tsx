// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";

/**
 * Behaviour under test: submitting the login form with valid credentials
 * pre-flights `/api/auth/login-check` (P1 — keeps wrong-creds 401s off the
 * browser console) then calls `signIn()` and hard-navigates to /farms on
 * success.
 *
 * Contract pinned here:
 *  - the page calls `fetch('/api/auth/login-check', POST)` BEFORE signIn
 *  - on `{ ok: true }` it then calls
 *    `signIn("credentials", { redirect: false })` (dynamic import keeps
 *    next-auth's React client off the cold bundle)
 *  - on signIn `ok: true` it hard-navigates via window.location.assign
 *  - on `{ ok: false }` from the pre-flight it surfaces the error and
 *    NEVER calls signIn (so the browser never sees a 401)
 */

const signInMock = vi.fn();
const fetchMock = vi.fn();
const assignMock = vi.fn();

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

// Visual audit P1 (2026-05-04): login page now reads `?next=` via
// useSearchParams() (sanitised via getSafeNext()). Stub the hook so the
// page renders outside a Next runtime; with no `next` param the safe
// fallback is `/farms`, matching the assertion below.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useSearchParams: () => new URLSearchParams(),
  };
});

beforeEach(() => {
  signInMock.mockReset();
  fetchMock.mockReset();
  assignMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      assign: assignMock,
    },
  });
});

afterEach(() => cleanup());

async function loadLoginPage(): Promise<React.ComponentType> {
  // Resolve lazily so the move from app/login → app/(auth)/login is
  // transparent to the test — the import path uses the (auth) group.
  const mod = await import("@/app/(auth)/login/page");
  return mod.default;
}

describe("login page", () => {
  it("hard-navigates to /farms on successful pre-flight + signIn", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    signInMock.mockResolvedValue({ ok: true, error: null });
    const LoginPage = await loadLoginPage();
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/^username$/i), {
      target: { value: "dicky" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct-horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/login-check",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith("credentials", {
        identifier: "dicky",
        password: "correct-horse",
        redirect: false,
      });
    });
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/farms"));
  });

  it("shows a distinct network-error toast when fetch() throws", async () => {
    // Wave 6b (#261) acceptance #6: a network failure (fetch rejection)
    // must surface "Couldn't reach the server — check your connection",
    // NOT the generic credential error. Without this branch the user is
    // wrongly told to check their password while their wifi is down.
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const LoginPage = await loadLoginPage();
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/^username$/i), {
      target: { value: "dicky" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct-horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't reach the server/i),
      ).toBeInTheDocument();
    });
    expect(signInMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("shows an error and does not call signIn on invalid credentials", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, reason: "INVALID_CREDENTIALS" }),
    });
    const LoginPage = await loadLoginPage();
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/^username$/i), {
      target: { value: "wrong@user.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/wrong username or password/i),
      ).toBeInTheDocument();
    });
    expect(signInMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });
});
