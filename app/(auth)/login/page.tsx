"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AUTH_ERROR_CODES } from "@/lib/auth-errors";
import { getSafeNext } from "@/lib/auth-redirect";

// No `useRouter()` import: a successful login triggers a full-document
// navigation to /farms via `window.location.assign()`. The session cookie was
// just set by next-auth, so the subsequent server-rendered /farms reads the
// fresh session natively.

// framer-motion used to animate entry of logo + card here. Replaced
// with CSS-only fade/rise-in (see globals.css `.auth-rise-in`) so the
// login bundle stays under its 100 KB brotli budget.
//
// `next-auth/react`'s `signIn` is dynamically imported at submit-time
// (see handleSubmit) so the ~12 KB brotli next-auth client chunk only
// downloads when the user actually presses the button, not on the
// cold first-paint of the login form.
//
// P1 — submit flow goes through `/api/auth/login-check` FIRST so the browser
// network layer never sees a 401 on bad credentials (the browser auto-emits
// "Failed to load resource: 401" to the console BEFORE app code can intercept,
// same root-cause class as the A.2 verify-email fix in commit a0fe84c). The
// pre-flight returns 200 + `{ ok, reason? }`. signIn() is only called when
// `ok: true`, where it's guaranteed to succeed against the same authorize()
// validation that the pre-flight just passed.

/**
 * Map specific auth error codes (thrown by authorize()) to user-facing copy.
 * Anything unrecognised falls through to the generic credentials message so
 * we never leak server internals to the UI.
 */
// Wave 6b (#261): copy is username-only — no email/username slash. The
// network-failure case is handled separately in handleSubmit (see
// NETWORK_ERROR_COPY) so users get a distinct "couldn't reach server"
// toast instead of a generic "wrong password" blame.
const AUTH_ERROR_COPY: Record<string, string> = {
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]:
    "Wrong username or password — try again.",
  [AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED]:
    "Your email isn't verified yet. Check your inbox (and spam) for the verification link we sent when you registered.",
  [AUTH_ERROR_CODES.RATE_LIMITED]:
    "Too many attempts. Wait about a minute before trying again.",
  [AUTH_ERROR_CODES.SERVER_MISCONFIGURED]:
    "Server is misconfigured (database env vars missing). Contact support — this isn't your password.",
  [AUTH_ERROR_CODES.DB_UNAVAILABLE]:
    "We can't reach the login database right now. Try again in a minute — your password is probably fine.",
};

const NETWORK_ERROR_COPY =
  "Couldn't reach the server — check your connection.";

// Visual audit P1 (2026-05-04): split into Suspense-wrapped shell + the
// actual form so `useSearchParams()` in `LoginForm` does not opt the
// whole page out of static generation. The Suspense boundary is required
// by Next 16 whenever a client component reads search params.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  // `next` is user-controllable — sanitise via getSafeNext() before
  // navigating to defend against open-redirect (`/login?next=//evil`).
  //
  // P1.6 — also accept `callbackUrl` (next-auth's convention) so the
  // session-expiry banner's `signIn(undefined, { callbackUrl })` lands the
  // user back on their original page after re-auth. `next=` wins if both
  // are present (the proxy.ts deep-link path uses `next=`). Both flow
  // through getSafeNext, which rejects open-redirect attempts.
  const safeNext =
    getSafeNext(searchParams.get("next")) ??
    getSafeNext(searchParams.get("callbackUrl")) ??
    "/farms";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Pre-flight: validate credentials against /api/auth/login-check, which
      // ALWAYS returns 200 (or 500 for true server errors) with a typed
      // payload. This keeps wrong-credentials off the browser's auto-error
      // network log — see header comment for the full rationale.
      const res = await fetch("/api/auth/login-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const check = (await res.json()) as
        | { ok: true }
        | { ok: false; reason?: string };

      if (!check.ok) {
        const reason = check.reason ?? AUTH_ERROR_CODES.INVALID_CREDENTIALS;
        const copy =
          AUTH_ERROR_COPY[reason] ??
          AUTH_ERROR_COPY[AUTH_ERROR_CODES.INVALID_CREDENTIALS];
        setError(copy);
        return;
      }

      // Pre-flight passed — call signIn(). Lazy-load next-auth's React client
      // on-submit so it doesn't bloat the /login cold bundle. The dynamic
      // import resolves in ~20 ms on 4G — imperceptible vs. the server
      // round-trip. See tests in __tests__/auth/login-signin-flow.test.tsx.
      const { signIn } = await import("next-auth/react");
      const result = await signIn("credentials", {
        identifier,
        password,
        redirect: false,
      });

      if (result?.ok) {
        // Hard navigation — full document load picks up the fresh
        // session cookie next-auth just set. Visual P1: honour the
        // sanitised `?next=` so deep-link clicks land back on the page
        // the user originally tried to open.
        window.location.assign(safeNext);
      } else {
        // Theoretically unreachable: pre-flight just confirmed the same
        // creds are valid. If it happens, fall back to the generic message
        // without leaking server internals.
        setError(AUTH_ERROR_COPY[AUTH_ERROR_CODES.INVALID_CREDENTIALS]);
      }
    } catch {
      // Distinct from the credential-error toast — the user reaching
      // this branch means fetch() threw (DNS, offline, CORS) before the
      // server ever responded. Acceptance criterion #6 (issue #261).
      setError(NETWORK_ERROR_COPY);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "rgba(15,9,3,0.70)",
    border: "1px solid rgba(140,100,60,0.25)",
    borderRadius: "10px",
    padding: "0.625rem 0.875rem",
    color: "#F0DEB8",
    fontFamily: "var(--font-sans)",
    fontSize: "0.9375rem",
    outline: "none",
    width: "100%",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-sans)",
    color: "#8A6840",
    fontSize: "0.75rem",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 relative overflow-hidden"
      style={{ background: "#1A1510" }}
    >
      {/* Radial amber glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 60%, rgba(196,144,48,0.10) 0%, transparent 70%)",
          zIndex: 1,
        }}
      />

      {/* Logo */}
      <div
        className="relative flex flex-col items-center gap-1 mb-8 auth-rise-in"
        style={{ zIndex: 10, animationDelay: "0.05s" }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            color: "#F0DEB8",
            fontSize: "2.5rem",
            fontWeight: 700,
            letterSpacing: "0.01em",
            lineHeight: 1.1,
          }}
        >
          FarmTrack
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#6A4E30",
            fontSize: "0.75rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Livestock Management
        </p>
        <div className="flex items-center justify-center gap-3 mt-2">
          <div style={{ height: "1px", width: "32px", background: "rgba(196,144,48,0.25)" }} />
          <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "rgba(196,144,48,0.40)" }} />
          <div style={{ height: "1px", width: "32px", background: "rgba(196,144,48,0.25)" }} />
        </div>
      </div>

      {/* Card */}
      <div
        className="relative w-full max-w-sm px-8 py-10 flex flex-col gap-8 auth-rise-in"
        style={{
          zIndex: 10,
          animationDelay: "0.12s",
          borderRadius: "2rem",
          background: "#241C14",
          border: "1px solid rgba(196,144,48,0.18)",
          boxShadow: "0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)",
        }}
      >
        {/* Form */}
        {/*
          Explicit method="post" + action are critical: if JS fails to load
          (PWA stale, ad blocker, slow 3G abort), the browser's native
          fallback would otherwise default to GET and leak `identifier` +
          `password` into the URL bar and access logs. NextAuth's credentials
          callback accepts POST, so the fallback degrades gracefully — at
          worst the user gets a CSRF challenge instead of a credential leak.
        */}
        <form
          onSubmit={handleSubmit}
          method="post"
          action="/api/auth/callback/credentials"
          className="flex flex-col gap-4"
        >
          {/* Username — Wave 6b (#261) renamed from "Email or Username".
              Sign-in identifier is username only; see tasks/auth-and-users.md. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="identifier" style={labelStyle}>
              Username
            </label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="username"
              style={inputStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(196,144,48,0.55)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(196,144,48,0.08)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(140,100,60,0.25)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" style={labelStyle}>
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={inputStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(196,144,48,0.55)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(196,144,48,0.08)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(140,100,60,0.25)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Error — role="alert" + aria-live="assertive" so screen readers
              interrupt and announce the failure immediately (P4). Credential
              errors are action-blocking, so assertive (not polite) is correct. */}
          {error && (
            <p
              role="alert"
              aria-live="assertive"
              style={{
                fontFamily: "var(--font-sans)",
                color: "#E07060",
                fontSize: "0.8125rem",
                background: "rgba(200,60,40,0.10)",
                border: "1px solid rgba(200,60,40,0.20)",
                borderRadius: "8px",
                padding: "0.5rem 0.75rem",
              }}
            >
              {error}
            </p>
          )}

          {/* Submit */}
          {/* aria-busy pairs with `disabled` so AT + Playwright agree on
              the in-flight state (matches /register pattern). */}
          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            style={{
              marginTop: "0.25rem",
              background: loading
                ? "rgba(160,100,40,0.35)"
                : "linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)",
              border: "1px solid rgba(196,144,48,0.35)",
              borderRadius: "10px",
              padding: "0.75rem 1rem",
              color: loading ? "rgba(240,222,184,0.50)" : "#F0DEB8",
              fontFamily: "var(--font-sans)",
              fontSize: "0.9375rem",
              fontWeight: 500,
              letterSpacing: "0.03em",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.18s ease",
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background =
                  "linear-gradient(135deg, rgba(212,160,56,0.95) 0%, rgba(180,115,45,0.95) 100%)";
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(196,144,48,0.25)";
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.background =
                  "linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)";
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
              }
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        {/* Register link */}
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#6A4E30",
            fontSize: "0.8125rem",
            textAlign: "center",
          }}
        >
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            style={{ color: "#8A6840", textDecoration: "underline" }}
          >
            Register
          </Link>
        </p>
      </div>

      <footer
        className="mt-8 text-xs text-center"
        style={{
          color: "#3A2A1A",
          fontFamily: "var(--font-sans)",
          zIndex: 10,
          position: "relative",
        }}
      >
        © {new Date().getFullYear()} FarmTrack
      </footer>
    </div>
  );
}
