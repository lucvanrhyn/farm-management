// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";

/**
 * Behaviour under test: submitting the login form with credentials that
 * `signIn()` resolves as `{ ok: true }` hard-navigates the browser to
 * /farms.
 *
 * This pins the core product flow after the P5 refactor:
 *  - the page calls `signIn("credentials", { redirect: false })` via
 *    a dynamic import of next-auth/react (keeps it off the cold
 *    first-load chunk)
 *  - it inspects the result and hard-navigates to /farms on success
 *    (window.location.assign — picks up the freshly-set cookie via
 *    a full document load)
 *
 * If either side of that contract changes, users either get stuck on
 * /login or lose their session in a redirect loop.
 */

const signInMock = vi.fn();
const assignMock = vi.fn();

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

beforeEach(() => {
  signInMock.mockReset();
  assignMock.mockReset();
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
  it("hard-navigates to /farms on successful signIn", async () => {
    signInMock.mockResolvedValue({ ok: true, error: null });
    const LoginPage = await loadLoginPage();
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email or username/i), {
      target: { value: "dicky" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct-horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith("credentials", {
        identifier: "dicky",
        password: "correct-horse",
        redirect: false,
      });
    });
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/farms"));
  });

  it("shows an error and does not redirect on invalid credentials", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "INVALID_CREDENTIALS" });
    const LoginPage = await loadLoginPage();
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email or username/i), {
      target: { value: "wrong@user.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/incorrect email\/username or password/i),
      ).toBeInTheDocument();
    });
    expect(assignMock).not.toHaveBeenCalled();
  });
});
