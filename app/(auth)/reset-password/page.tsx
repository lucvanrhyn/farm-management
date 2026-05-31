"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

/**
 * Reset-password confirm page — slice 2 of issue #102.
 *
 * Reads `?token=` from the URL (set by the email link from slice 1).
 * Missing/empty token → error state with a link back to /forgot-password.
 * Valid form submission → POST /api/auth/reset-password.
 *
 * On { valid: true }: "Password updated — sign in again" + link to /login.
 * On { valid: false }: expired/invalid token message + link to /forgot-password.
 *
 * Security note — session invalidation residual:
 *   Existing JWT sessions survive to their 8h expiry after a successful reset.
 *   Full revocation requires a token-version column on users + a compare in the
 *   JWT callback. That is out of scope for this slice and tracked on issue #102.
 *
 * Next 16 requires `useSearchParams` inside a Suspense boundary. The inner
 * component holds the business logic; the default export just wraps it.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Shell state="loading" />}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  // Missing token → error immediately; no network call needed.
  const [state, setState] = useState<
    "idle" | "submitting" | "success" | "invalid_token" | "no_token" | "error"
  >(token ? "idle" : "no_token");

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fieldError, setFieldError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation mirrors the server (8 chars, match).
    if (password.length < 8) {
      setFieldError("Password must be at least 8 characters.");
      return;
    }
    if (password !== passwordConfirm) {
      setFieldError("Passwords do not match.");
      return;
    }

    setFieldError("");
    setState("submitting");

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, passwordConfirm }),
      });

      // Always 200 for valid/invalid token paths; 5xx for server errors.
      if (res.status >= 500) {
        setState("error");
        return;
      }

      const data = await res.json().catch(() => null);
      if (!data) {
        setState("error");
        return;
      }

      if (data.valid) {
        setState("success");
      } else {
        setState("invalid_token");
      }
    } catch {
      setState("error");
    }
  }

  return <Shell state={state} password={password} passwordConfirm={passwordConfirm} fieldError={fieldError} setPassword={setPassword} setPasswordConfirm={setPasswordConfirm} onSubmit={handleSubmit} />;
}

// ── Presentational shell ─────────────────────────────────────────────────────

interface ShellProps {
  state: "loading" | "idle" | "submitting" | "success" | "invalid_token" | "no_token" | "error";
  password?: string;
  passwordConfirm?: string;
  fieldError?: string;
  setPassword?: (v: string) => void;
  setPasswordConfirm?: (v: string) => void;
  onSubmit?: (e: React.FormEvent) => void;
}

function Shell({
  state,
  password = "",
  passwordConfirm = "",
  fieldError = "",
  setPassword,
  setPasswordConfirm,
  onSubmit,
}: ShellProps) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5"
      style={{ background: "#1A1510" }}
    >
      <div
        className="w-full max-w-sm px-8 py-10 flex flex-col items-center gap-6"
        style={{
          borderRadius: "2rem",
          background: "#241C14",
          border: "1px solid rgba(196,144,48,0.18)",
          boxShadow:
            "0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)",
        }}
      >
        {state === "loading" && (
          <p style={{ color: "#F0DEB8", fontFamily: "var(--font-sans)" }}>
            Loading…
          </p>
        )}

        {state === "success" && <SuccessPanel />}

        {(state === "invalid_token" || state === "no_token") && (
          <InvalidTokenPanel
            reason={
              state === "no_token"
                ? "No reset token was provided."
                : "Your reset link has expired or has already been used."
            }
          />
        )}

        {state === "error" && (
          <>
            <ErrorIcon />
            <h1 style={titleStyle}>Reset failed</h1>
            <div role="status" aria-live="polite">
              <p role="alert" aria-live="assertive" style={errorTextStyle}>
                Something went wrong. Please try again.
              </p>
            </div>
            <Link href="/forgot-password" style={linkStyle}>
              Request a new reset link
            </Link>
          </>
        )}

        {(state === "idle" || state === "submitting") && (
          <FormPanel
            state={state}
            password={password}
            passwordConfirm={passwordConfirm}
            fieldError={fieldError}
            setPassword={setPassword!}
            setPasswordConfirm={setPasswordConfirm!}
            onSubmit={onSubmit!}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-panels ───────────────────────────────────────────────────────────────

function SuccessPanel() {
  return (
    <>
      <div style={iconCircleStyle("rgba(74,124,89,0.2)")}>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#4A7C59"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h1 style={titleStyle}>Password updated</h1>
      <p style={subtitleStyle}>
        Your password has been changed. You can now sign in with your new
        password.
      </p>
      <Link href="/login" style={primaryButtonStyle}>
        Sign in
      </Link>
    </>
  );
}

function InvalidTokenPanel({ reason }: { reason: string }) {
  return (
    <>
      <ErrorIcon />
      <h1 style={titleStyle}>Link invalid or expired</h1>
      {/* Error region — permanent role="status" outer, inner role="alert" (#111 pattern) */}
      <div role="status" aria-live="polite">
        <p role="alert" aria-live="assertive" style={errorTextStyle}>
          {reason}
        </p>
      </div>
      <p style={subtitleStyle}>
        Reset links expire after 24 hours and can only be used once.
      </p>
      <Link href="/forgot-password" style={primaryButtonStyle}>
        Request a new reset link
      </Link>
    </>
  );
}

interface FormPanelProps {
  state: "idle" | "submitting";
  password: string;
  passwordConfirm: string;
  fieldError: string;
  setPassword: (v: string) => void;
  setPasswordConfirm: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

function FormPanel({
  state,
  password,
  passwordConfirm,
  fieldError,
  setPassword,
  setPasswordConfirm,
  onSubmit,
}: FormPanelProps) {
  const isSubmitting = state === "submitting";

  return (
    <>
      <h1 style={titleStyle}>Set new password</h1>
      <p style={subtitleStyle}>
        Choose a strong password with at least 8 characters.
      </p>
      <form
        onSubmit={onSubmit}
        method="post"
        action="/api/auth/reset-password"
        className="w-full flex flex-col gap-3"
        aria-label="Set a new password"
        noValidate
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="rp-password" style={labelStyle}>
            New password
          </label>
          <input
            id="rp-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            style={inputStyle}
            aria-describedby={fieldError ? "rp-field-error" : undefined}
            aria-invalid={fieldError ? true : undefined}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="rp-password-confirm" style={labelStyle}>
            Confirm new password
          </label>
          <input
            id="rp-password-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            placeholder="Repeat your new password"
            style={inputStyle}
            aria-describedby={fieldError ? "rp-field-error" : undefined}
          />
        </div>

        {/* Field error region (#111 pattern) */}
        <div role="status" aria-live="polite">
          {fieldError ? (
            <p
              id="rp-field-error"
              role="alert"
              aria-live="assertive"
              style={{ color: "#E07060", fontFamily: "var(--font-sans)", fontSize: "0.75rem" }}
            >
              {fieldError}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          style={{
            marginTop: "0.25rem",
            background: isSubmitting
              ? "rgba(160,100,40,0.35)"
              : "linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)",
            border: "1px solid rgba(196,144,48,0.35)",
            borderRadius: "10px",
            padding: "0.625rem 1rem",
            color: isSubmitting ? "rgba(240,222,184,0.5)" : "#F0DEB8",
            fontFamily: "var(--font-sans)",
            fontSize: "0.9rem",
            fontWeight: 500,
            cursor: isSubmitting ? "not-allowed" : "pointer",
            width: "100%",
          }}
        >
          {isSubmitting ? "Updating…" : "Update password"}
        </button>
      </form>

      <Link href="/forgot-password" style={linkStyle}>
        Request a different reset link
      </Link>
    </>
  );
}

// ── Shared style atoms ────────────────────────────────────────────────────────

function ErrorIcon() {
  return (
    <div style={iconCircleStyle("rgba(200,60,40,0.15)")}>
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#E07060"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </div>
  );
}

function iconCircleStyle(bg: string): React.CSSProperties {
  return {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: bg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  color: "#F0DEB8",
  fontSize: "1.5rem",
  fontWeight: 700,
  textAlign: "center",
};

const subtitleStyle: React.CSSProperties = {
  color: "#8A6840",
  fontFamily: "var(--font-sans)",
  fontSize: "0.875rem",
  textAlign: "center",
  lineHeight: 1.6,
};

const errorTextStyle: React.CSSProperties = {
  color: "#E07060",
  fontFamily: "var(--font-sans)",
  fontSize: "0.875rem",
  textAlign: "center",
};

const labelStyle: React.CSSProperties = {
  color: "#C9B48A",
  fontFamily: "var(--font-sans)",
  fontSize: "0.8125rem",
};

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
  boxSizing: "border-box",
};

const primaryButtonStyle: React.CSSProperties = {
  marginTop: "0.5rem",
  background:
    "linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)",
  border: "1px solid rgba(196,144,48,0.35)",
  borderRadius: "10px",
  padding: "0.75rem 2rem",
  color: "#F0DEB8",
  fontFamily: "var(--font-sans)",
  fontSize: "0.9375rem",
  fontWeight: 500,
  textDecoration: "none",
  textAlign: "center",
};

const linkStyle: React.CSSProperties = {
  marginTop: "0.25rem",
  color: "#8A6840",
  fontFamily: "var(--font-sans)",
  fontSize: "0.875rem",
  textDecoration: "underline",
};
