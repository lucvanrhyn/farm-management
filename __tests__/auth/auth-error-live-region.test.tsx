// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

/**
 * #111 — auth error regions must live inside an OUTER `role="status"
 * aria-live="polite"` container while the message text itself keeps
 * `role="alert"`.
 *
 * Why the double wrapper? A bare `role="alert" aria-live="assertive"` node
 * that is conditionally mounted only when an error appears is, in several
 * screen-reader / browser combinations, NOT reliably announced: the live
 * region has to already exist in the accessibility tree at the moment its
 * subtree changes. Mounting a permanent `role="status"` (polite) container
 * and swapping the inner alert in/out gives the AT a stable region to watch,
 * so the failure is announced every time — including the second consecutive
 * failure with identical copy.
 *
 * The test renders the real page and drives the bad-credentials path so we
 * catch refactors that drop the wrapper or move the role onto a child.
 */

const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useSearchParams: () => new URLSearchParams(),
  };
});

const fetchMock = vi.fn();
const assignMock = vi.fn();

beforeEach(() => {
  signInMock.mockReset();
  fetchMock.mockReset();
  assignMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: assignMock },
  });
});

afterEach(() => cleanup());

async function loadLoginPage(): Promise<React.ComponentType> {
  const mod = await import("@/app/(auth)/login/page");
  return mod.default;
}

function fillAndSubmit(identifier = "nobody", password = "nope"): void {
  fireEvent.change(screen.getByLabelText(/^username$/i), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("login page — error region aria-live wrapper (#111)", () => {
  it('wraps the alert in an OUTER role="status" aria-live="polite" container', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, reason: "INVALID_CREDENTIALS" }),
    });

    const LoginPage = await loadLoginPage();
    render(<LoginPage />);
    fillAndSubmit();

    // The message keeps role="alert" (assertive, action-blocking copy).
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/wrong username or password/i);
    expect(alert.getAttribute("aria-live")).toBe("assertive");

    // …and it must be nested inside a polite status region (the stable
    // live region that guarantees announcement).
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.contains(alert)).toBe(true);
  });
});
