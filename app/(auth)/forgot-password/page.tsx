"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Forgot-password page — slice 1 of issue #102.
 *
 * Security: the form never reveals whether the submitted email is registered.
 * On submit it always shows "check your inbox" regardless of the API response
 * shape (the endpoint itself is anti-enumeration; the UI adds an extra layer
 * by never branching on the result).
 *
 * Slice 2 (reset-confirm page at /reset-password) stacks on the same branch.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [fieldError, setFieldError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();

    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setFieldError("Please enter a valid email address.");
      return;
    }

    setFieldError("");
    setState("sending");

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });

      // Anti-enumeration: always show "check your inbox" for any 2xx or
      // rate-limit (429 — the endpoint also returns 200 on per-email RL, but
      // be defensive against the IP-level 429). Only genuine server errors
      // (5xx) get the error state.
      if (res.status >= 500) {
        setState("error");
        return;
      }

      setState("sent");
    } catch {
      setState("error");
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "rgba(15,9,3,0.70)",
    border: "1px solid rgba(140,100,60,0.25)",
    borderRadius: "10px",
    padding: "0.625rem 0.875rem",
    color: "var(--ft-fair-bg)",
    fontFamily: "var(--font-sans)",
    fontSize: "0.9375rem",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5"
      style={{ background: "var(--ft-text)" }}
    >
      <div
        className="w-full max-w-sm px-8 py-10 flex flex-col items-center gap-6"
        style={{
          borderRadius: "2rem",
          background: "var(--ft-text)",
          border: "1px solid rgba(196,144,48,0.18)",
          boxShadow:
            "0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)",
        }}
      >
        {state === "sent" ? (
          <SentPanel />
        ) : (
          <FormPanel
            email={email}
            setEmail={setEmail}
            state={state}
            fieldError={fieldError}
            inputStyle={inputStyle}
            onSubmit={handleSubmit}
          />
        )}

        {state === "error" && (
          <div role="status" aria-live="polite">
            <p
              role="alert"
              aria-live="assertive"
              style={{
                color: "#E07060",
                fontFamily: "var(--font-sans)",
                fontSize: "0.875rem",
                textAlign: "center",
              }}
            >
              Something went wrong. Please try again.
            </p>
          </div>
        )}

        <Link
          href="/login"
          style={{
            color: "#8A6840",
            fontFamily: "var(--font-sans)",
            fontSize: "0.875rem",
            textDecoration: "underline",
          }}
        >
          Back to login
        </Link>
      </div>
    </div>
  );
}

function SentPanel() {
  return (
    <>
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          background: "rgba(74,124,89,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ft-good)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--ft-fair-bg)",
          fontSize: "1.5rem",
          fontWeight: 700,
          textAlign: "center",
        }}
      >
        Check your inbox
      </h1>
      <p
        style={{
          color: "#8A6840",
          fontFamily: "var(--font-sans)",
          fontSize: "0.875rem",
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        If an account is registered for that email, a password reset link is on
        the way. Check your inbox and spam folder. The link expires in 24 hours.
      </p>
    </>
  );
}

interface FormPanelProps {
  email: string;
  setEmail: (v: string) => void;
  state: "idle" | "sending" | "error";
  fieldError: string;
  inputStyle: React.CSSProperties;
  onSubmit: (e: React.FormEvent) => void;
}

function FormPanel({
  email,
  setEmail,
  state,
  fieldError,
  inputStyle,
  onSubmit,
}: FormPanelProps) {
  return (
    <>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--ft-fair-bg)",
          fontSize: "1.5rem",
          fontWeight: 700,
          textAlign: "center",
        }}
      >
        Forgot password
      </h1>
      <p
        style={{
          color: "#8A6840",
          fontFamily: "var(--font-sans)",
          fontSize: "0.875rem",
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        Enter your email and we&apos;ll send you a reset link if an account
        exists for that address.
      </p>
      <form
        onSubmit={onSubmit}
        method="post"
        action="/api/auth/forgot-password"
        className="w-full flex flex-col gap-3"
        aria-label="Request a password reset link"
        noValidate
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="fp-email"
            style={{
              color: "#C9B48A",
              fontFamily: "var(--font-sans)",
              fontSize: "0.8125rem",
            }}
          >
            Email address
          </label>
          <input
            id="fp-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={inputStyle}
            aria-describedby={fieldError ? "fp-email-error" : undefined}
            aria-invalid={fieldError ? true : undefined}
          />
          <div role="status" aria-live="polite">
            {fieldError ? (
              <p
                id="fp-email-error"
                role="alert"
                aria-live="assertive"
                style={{
                  color: "#E07060",
                  fontFamily: "var(--font-sans)",
                  fontSize: "0.75rem",
                }}
              >
                {fieldError}
              </p>
            ) : null}
          </div>
        </div>

        <button
          type="submit"
          disabled={state === "sending"}
          aria-busy={state === "sending"}
          style={{
            marginTop: "0.25rem",
            background:
              state === "sending"
                ? "rgba(160,100,40,0.35)"
                : "linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)",
            border: "1px solid rgba(196,144,48,0.35)",
            borderRadius: "10px",
            padding: "0.625rem 1rem",
            color:
              state === "sending" ? "rgba(240,222,184,0.5)" : "var(--ft-fair-bg)",
            fontFamily: "var(--font-sans)",
            fontSize: "0.9rem",
            fontWeight: 500,
            cursor: state === "sending" ? "not-allowed" : "pointer",
            width: "100%",
          }}
        >
          {state === "sending" ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </>
  );
}
