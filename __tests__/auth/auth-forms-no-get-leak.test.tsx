// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

/**
 * Phase A1 + A2 — credential leak prevention.
 *
 * If JS fails to load (PWA stale, ad blocker, slow 3G abort), the browser
 * falls back to the native HTML form `submit()`. Without an explicit
 * `method="post"`, that fallback is `GET`, so the credentials end up in the
 * URL bar and server access logs.
 *
 * The fix is to give every auth form an explicit `method="post"` plus a
 * concrete `action` route. This pins the contract so future edits cannot
 * silently regress the GET-leak.
 */

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}));

// Visual audit P1 (2026-05-04): login page reads `?next=` via
// useSearchParams(). Stub it so the form renders outside a Next runtime.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useSearchParams: () => new URLSearchParams(),
  };
});

afterEach(() => cleanup());

describe("login form — never leaks credentials in URL", () => {
  it("uses method='post' on the <form> element", async () => {
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    const { container } = render(<LoginPage />);
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    // HTML default is GET. Explicit method="post" is required so the
    // native fallback (no-JS) submits credentials in the request body
    // rather than the URL query string.
    expect(form!.getAttribute("method")?.toLowerCase()).toBe("post");
  });

  it("has a concrete action attribute (no implicit same-URL GET)", async () => {
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    const { container } = render(<LoginPage />);
    const form = container.querySelector("form");
    const action = form!.getAttribute("action");
    expect(action).toBeTruthy();
    expect(action!.length).toBeGreaterThan(0);
  });
});

describe("register form — never leaks PII in URL", () => {
  it("uses method='post' on the <form> element", async () => {
    const { default: RegisterPage } = await import("@/app/(auth)/register/page");
    const { container } = render(<RegisterPage />);
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form!.getAttribute("method")?.toLowerCase()).toBe("post");
  });

  it("has a concrete action attribute pointing to the register API", async () => {
    const { default: RegisterPage } = await import("@/app/(auth)/register/page");
    const { container } = render(<RegisterPage />);
    const form = container.querySelector("form");
    const action = form!.getAttribute("action");
    expect(action).toBeTruthy();
    expect(action).toContain("/api/auth/register");
  });
});
