"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage("No verification token provided.");
      return;
    }

    fetch(`/api/auth/verify-email?token=${token}`)
      .then(async (res) => {
        if (res.ok) {
          setStatus("success");
        } else {
          const data = await res.json();
          setStatus("error");
          setErrorMessage(data.error ?? "Verification failed.");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMessage("Network error. Please try again.");
      });
  }, [token]);

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

        {status === "success" && (
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
            <p style={{ color: "#8A6840", fontFamily: "var(--font-sans)", fontSize: "0.875rem", textAlign: "center" }}>
              Your account is ready. You can now sign in to FarmTrack.
            </p>
            <Link
              href="/login"
              style={{
                marginTop: "0.5rem",
                background: "linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)",
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
        )}

        {status === "error" && (
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#E07060" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
            <p style={{ color: "#E07060", fontFamily: "var(--font-sans)", fontSize: "0.875rem", textAlign: "center" }}>
              {errorMessage}
            </p>
            <Link
              href="/login"
              style={{
                marginTop: "0.5rem",
                color: "#8A6840",
                fontFamily: "var(--font-sans)",
                fontSize: "0.875rem",
                textDecoration: "underline",
              }}
            >
              Back to login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
