// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

/**
 * A4 — register-form a11y attrs.
 *
 * Two gaps in the original page:
 *
 *  1. `confirmPassword` had `required` but no `minLength` — a screen-reader
 *     submitting an 8-char `password` and a 1-char `confirmPassword` would
 *     pass HTML constraint validation on the second field, fall through to
 *     the JS handler, and surface only the post-submit "passwords do not
 *     match" error. Adding `minLength={8}` (parity with `password`) lets
 *     the browser's native validation flag the short input the same way
 *     it already does for `password`.
 *
 *  2. Neither password input was tied to the visible "Min 8 characters"
 *     hint via `aria-describedby`. Sighted users see the placeholder; AT
 *     users had no programmatic link to the rules. Promoting the rules to
 *     a real `<p id="password-rules">` and pointing `aria-describedby` at
 *     it from both `password` + `confirmPassword` closes the gap with a
 *     single description element (one source of truth).
 *
 * Tests assert the attributes on the rendered DOM rather than the source
 * file so we catch refactors that move attributes onto a wrapper or
 * accidentally drop them under a conditional render.
 */

afterEach(() => cleanup());

async function loadRegisterPage(): Promise<React.ComponentType> {
  const mod = await import("@/app/(auth)/register/page");
  return mod.default;
}

describe("register page — a11y attributes (A4)", () => {
  it("password input has minLength=8 and aria-describedby='password-rules'", async () => {
    const RegisterPage = await loadRegisterPage();
    render(<RegisterPage />);

    const password = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    expect(password.getAttribute("minlength")).toBe("8");
    expect(password.getAttribute("aria-describedby")).toBe("password-rules");
  });

  it("confirmPassword input has minLength=8 and aria-describedby='password-rules'", async () => {
    const RegisterPage = await loadRegisterPage();
    render(<RegisterPage />);

    const confirm = screen.getByLabelText(/confirm password/i) as HTMLInputElement;
    expect(confirm.getAttribute("minlength")).toBe("8");
    expect(confirm.getAttribute("aria-describedby")).toBe("password-rules");
  });

  it("renders a visible #password-rules element with the 8-char rule", async () => {
    const RegisterPage = await loadRegisterPage();
    const { container } = render(<RegisterPage />);

    const rules = container.querySelector("#password-rules");
    expect(rules).not.toBeNull();
    expect(rules!.textContent ?? "").toMatch(/8/);
  });
});
