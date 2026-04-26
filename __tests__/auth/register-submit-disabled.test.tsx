// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";

/**
 * Phase A3 — submit button must be disabled while the registration request
 * is in flight, and must announce the busy state via `aria-busy="true"`.
 *
 * The bug: the existing button only changes its label to "Creating your
 * farm..." without `disabled`. A user double-clicking during the ~4 s
 * provisioning window fires a second POST /api/auth/register, hits the
 * 5/hr IP rate limit, and is bounced with a 429 — even though the first
 * request will eventually succeed.
 *
 * The fix: `disabled={loading}` AND `aria-busy={loading}` so screen readers
 * + Playwright both see the busy state.
 */

afterEach(() => cleanup());

beforeEach(() => {
  // We never want the real fetch to fire. Hand it a Promise we never resolve
  // so the loading state stays "in flight" for the duration of the assertion.
  const fetchMock = vi.fn(() => new Promise(() => {}));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

async function loadRegisterPage(): Promise<React.ComponentType> {
  const mod = await import("@/app/(auth)/register/page");
  return mod.default;
}

describe("register page — submit button busy state", () => {
  it("disables the submit button while the request is in flight", async () => {
    const RegisterPage = await loadRegisterPage();
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Jan" },
    });
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "jan@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "jan" },
    });
    fireEvent.change(screen.getByLabelText(/farm name/i), {
      target: { value: "Rietfontein" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "supersecret" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "supersecret" },
    });

    const button = screen.getByRole("button", { name: /create account/i });
    fireEvent.click(button);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /creating your farm/i });
      expect(btn).toBeDisabled();
    });
  });

  it("sets aria-busy='true' on the submit button while in flight", async () => {
    const RegisterPage = await loadRegisterPage();
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Jan" },
    });
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "jan@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "jan" },
    });
    fireEvent.change(screen.getByLabelText(/farm name/i), {
      target: { value: "Rietfontein" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "supersecret" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "supersecret" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /creating your farm/i });
      expect(btn.getAttribute("aria-busy")).toBe("true");
    });
  });
});
