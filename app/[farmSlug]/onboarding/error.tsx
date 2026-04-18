"use client";

/**
 * Error boundary for the onboarding route segment.
 *
 * Contains any render-time failure (corrupted sessionStorage payload,
 * malformed ProposalResult, XLSX parse regression) within the wizard so
 * the rest of the app stays healthy. Offers a one-click reset that
 * clears sessionStorage and reloads the segment.
 */

import { useEffect } from "react";
import Link from "next/link";
import { ONBOARDING_STORAGE_KEY } from "@/lib/onboarding/storage";

export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console for DevTools + any error-reporting integration
    // that hooks window.onerror. Keep it a warning so prod dashboards don't
    // page on every private-mode-storage hiccup.
    console.warn("[onboarding] boundary caught:", error);
  }, [error]);

  const handleReset = () => {
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(ONBOARDING_STORAGE_KEY);
      }
    } catch {
      /* ignore — storage could be disabled */
    }
    reset();
  };

  return (
    <div
      className="min-h-[60vh] flex items-center justify-center px-5"
      style={{ background: "#1A1510" }}
    >
      <div
        className="w-full max-w-md px-8 py-10 flex flex-col items-center gap-5 text-center"
        style={{
          borderRadius: "1.5rem",
          background: "#241C14",
          border: "1px solid rgba(200,60,40,0.25)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "rgba(200,60,40,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-hidden
        >
          <span style={{ fontSize: 24 }}>⚠️</span>
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            color: "#F0DEB8",
            fontSize: "1.5rem",
            fontWeight: 700,
          }}
        >
          Onboarding hit a snag
        </h1>
        <p
          style={{
            color: "#8A6840",
            fontFamily: "var(--font-sans)",
            fontSize: "0.875rem",
            lineHeight: 1.5,
          }}
        >
          Something went wrong rendering the wizard. Resetting the session
          usually clears it — your file upload isn&apos;t shared until you
          click through the confirmation step, so nothing has been imported.
        </p>
        <button
          type="button"
          onClick={handleReset}
          style={{
            background:
              "linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)",
            border: "1px solid rgba(196,144,48,0.35)",
            borderRadius: 10,
            padding: "0.625rem 1.25rem",
            color: "#F0DEB8",
            fontFamily: "var(--font-sans)",
            fontSize: "0.9375rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Reset and try again
        </button>
        <Link
          href="/"
          style={{
            marginTop: "0.5rem",
            color: "#6A4E30",
            fontFamily: "var(--font-sans)",
            fontSize: "0.8125rem",
            textDecoration: "underline",
          }}
        >
          Back to home
        </Link>
        {error.digest ? (
          <p
            style={{
              color: "#3A2A1A",
              fontFamily: "var(--font-mono, ui-monospace)",
              fontSize: "0.6875rem",
              marginTop: "0.25rem",
            }}
          >
            ref: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
