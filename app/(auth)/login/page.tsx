"use client";

import { useState } from "react";
import Link from "next/link";
import { AUTH_ERROR_CODES } from "@/lib/auth-errors";

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

/**
 * Map specific auth error codes (thrown by authorize()) to user-facing copy.
 * Anything unrecognised falls through to the generic credentials message so
 * we never leak server internals to the UI.
 */
const AUTH_ERROR_COPY: Record<string, string> = {
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]:
    "Incorrect email/username or password. Try again.",
  [AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED]:
    "Your email isn't verified yet. Check your inbox (and spam) for the verification link we sent when you registered.",
  [AUTH_ERROR_CODES.RATE_LIMITED]:
    "Too many attempts. Wait about a minute before trying again.",
  [AUTH_ERROR_CODES.SERVER_MISCONFIGURED]:
    "Server is misconfigured (database env vars missing). Contact support — this isn't your password.",
  [AUTH_ERROR_CODES.DB_UNAVAILABLE]:
    "We can't reach the login database right now. Try again in a minute — your password is probably fine.",
};

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Lazy-load next-auth's React client on-submit so it doesn't
      // bloat the /login cold bundle. The dynamic import resolves in
      // ~20 ms on 4G — imperceptible vs. the server round-trip that
      // follows. See tests in __tests__/auth/login-signin-flow.test.tsx.
      const { signIn } = await import("next-auth/react");
      const result = await signIn("credentials", {
        identifier,
        password,
        redirect: false,
      });

      if (result?.error) {
        // NextAuth surfaces the authorize()-thrown Error#message as result.error.
        // Unknown strings fall back to the generic credentials copy.
        const copy =
          AUTH_ERROR_COPY[result.error] ??
          AUTH_ERROR_COPY[AUTH_ERROR_CODES.INVALID_CREDENTIALS];
        setError(copy);
      } else if (result?.ok) {
        // Hard navigation — full document load picks up the fresh
        // session cookie next-auth just set.
        window.location.assign("/farms");
      } else {
        setError("Sign in failed. Try again later.");
      }
    } catch {
      setError("Network error. Check your connection.");
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Identifier */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="identifier" style={labelStyle}>
              Email or Username
            </label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="email or username"
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

          {/* Error */}
          {error && (
            <p
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
          <button
            type="submit"
            disabled={loading}
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
