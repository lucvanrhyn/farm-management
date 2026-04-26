"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

/**
 * Next 16 requires `useSearchParams` inside a Suspense boundary. The inner
 * component holds the business logic; the outer export just wraps it.
 */
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyShell status="loading" errorMessage="" />}>
      <VerifyInner />
    </Suspense>
  );
}

function VerifyInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  // Derive initial state from whether the token is present — no setState in effect.
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    token ? "loading" : "error",
  );
  const [errorMessage, setErrorMessage] = useState(
    token ? "" : "No verification token provided.",
  );

  useEffect(() => {
    if (!token) return;

    fetch(`/api/auth/verify-email?token=${token}`)
      .then(async (res) => {
        if (res.ok) {
          setStatus("success");
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus("error");
          setErrorMessage(data.error ?? "Verification failed.");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMessage("Network error. Please try again.");
      });
  }, [token]);

  return <VerifyShell status={status} errorMessage={errorMessage} />;
}

function VerifyShell({
  status,
  errorMessage,
}: {
  status: "loading" | "success" | "error";
  errorMessage: string;
}) {
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
          boxShadow: "0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)",
        }}
      >
        {status === "loading" && (
          <p style={{ color: "#F0DEB8", fontFamily: "var(--font-sans)" }}>
            Verifying your email...
          </p>
        )}

        {status === "success" && <SuccessPanel />}
        {status === "error" && <ErrorPanel errorMessage={errorMessage} />}
      </div>
    </div>
  );
}

function SuccessPanel() {
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
          stroke="#4A7C59"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          color: "#F0DEB8",
          fontSize: "1.5rem",
          fontWeight: 700,
        }}
      >
        Email Verified
      </h1>
      <p
        style={{
          color: "#8A6840",
          fontFamily: "var(--font-sans)",
          fontSize: "0.875rem",
          textAlign: "center",
        }}
      >
        Your account is ready. You can now sign in to FarmTrack.
      </p>
      <Link
        href="/login"
        style={{
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
        }}
      >
        Sign In
      </Link>
    </>
  );
}

/**
 * Error state with a fresh-link recovery form.
 *
 * The verify URL only carries the token, so after an expired-token failure we
 * don't know whose email to re-send to. Ask the user for their email and POST
 * to /api/auth/resend-verification. That endpoint is anti-enumeration — it
 * returns success regardless of whether the email exists — so the UI shows a
 * generic "check your inbox" confirmation.
 */
function ErrorPanel({ errorMessage }: { errorMessage: string }) {
  const [email, setEmail] = useState("");
  const [resendState, setResendState] =
    useState<"idle" | "sending" | "sent" | "rate-limited">("idle");
  const [resendError, setResendError] = useState("");

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setResendState("sending");
    setResendError("");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) {
        setResendState("rate-limited");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setResendError(
          typeof data.error === "string"
            ? data.error
            : "Could not send. Try again in a minute.",
        );
        setResendState("idle");
        return;
      }
      setResendState("sent");
    } catch {
      setResendError("Network error. Check your connection.");
      setResendState("idle");
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

  return (
    <>
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          background: "rgba(200,60,40,0.15)",
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
          stroke="#E07060"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          color: "#F0DEB8",
          fontSize: "1.5rem",
          fontWeight: 700,
        }}
      >
        Verification Failed
      </h1>
      <p
        style={{
          color: "#E07060",
          fontFamily: "var(--font-sans)",
          fontSize: "0.875rem",
          textAlign: "center",
        }}
      >
        {errorMessage}
      </p>

      {resendState === "sent" || resendState === "rate-limited" ? (
        <p
          style={{
            color: "#C9B48A",
            fontFamily: "var(--font-sans)",
            fontSize: "0.8125rem",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          If an account exists for that email, a fresh verification link is on
          the way. Check your inbox (and spam).
        </p>
      ) : (
        <form
          onSubmit={handleResend}
          method="post"
          action="/api/auth/resend-verification"
          className="w-full flex flex-col gap-2"
          aria-label="Request a fresh verification link"
        >
          <p
            style={{
              color: "#C9B48A",
              fontFamily: "var(--font-sans)",
              fontSize: "0.8125rem",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            Link expired or lost it? Enter your email to send a fresh one.
          </p>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={inputStyle}
          />
          {resendError ? (
            <p
              style={{
                color: "#E07060",
                fontFamily: "var(--font-sans)",
                fontSize: "0.75rem",
              }}
            >
              {resendError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={resendState === "sending"}
            aria-busy={resendState === "sending"}
            style={{
              marginTop: "0.25rem",
              background:
                resendState === "sending"
                  ? "rgba(160,100,40,0.35)"
                  : "linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)",
              border: "1px solid rgba(196,144,48,0.35)",
              borderRadius: "10px",
              padding: "0.625rem 1rem",
              color:
                resendState === "sending" ? "rgba(240,222,184,0.5)" : "#F0DEB8",
              fontFamily: "var(--font-sans)",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: resendState === "sending" ? "not-allowed" : "pointer",
            }}
          >
            {resendState === "sending" ? "Sending…" : "Resend verification email"}
          </button>
        </form>
      )}

      <Link
        href="/login"
        style={{
          marginTop: "0.25rem",
          color: "#8A6840",
          fontFamily: "var(--font-sans)",
          fontSize: "0.875rem",
          textDecoration: "underline",
        }}
      >
        Back to login
      </Link>
    </>
  );
}
