"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function CompleteContent() {
  const { update } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const farmSlug = searchParams.get("farm");

  // Fast-fail when ?farm= is missing. Without a farm slug the polling loop
  // can do no useful work — it would tick 12 times over 24 s and drop into
  // an ambiguous timeout. Real users hit this branch from saved bookmarks,
  // PayFast return URLs that strip query params, manual URL entry, and
  // browser back/forward replays. Rendering the error immediately gives
  // them a clear explanation and a way out.
  const initialStatus: "refreshing" | "ready" | "timeout" | "missing-farm" =
    farmSlug ? "refreshing" : "missing-farm";

  const [status, setStatus] = useState<
    "refreshing" | "ready" | "timeout" | "missing-farm"
  >(initialStatus);

  useEffect(() => {
    // No farm slug → render the actionable error and skip polling entirely.
    if (!farmSlug) return;

    let attempts = 0;
    const MAX_ATTEMPTS = 12; // 24 seconds total

    async function poll() {
      attempts++;

      // Refresh the session JWT so it picks up the new subscription_status
      await update();

      // Check the live subscription status from the API
      try {
        const res = await fetch(`/api/subscription/status?farm=${farmSlug}`);
        if (res.ok) {
          const data = await res.json();
          if (data.subscriptionStatus === "active") {
            setStatus("ready");
            return;
          }
        }
      } catch {
        // Network error — keep polling
      }

      if (attempts >= MAX_ATTEMPTS) {
        setStatus("timeout");
        return;
      }

      setTimeout(poll, 2000);
    }

    poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmSlug]);

  function handleGoToFarm() {
    if (farmSlug) {
      router.push(`/${farmSlug}/admin`);
    } else {
      router.push("/farms");
    }
  }

  function handleRecoverFromMissingFarm() {
    router.push("/farms");
  }

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
        {status === "refreshing" && (
          <>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                border: "2px solid rgba(196,144,48,0.2)",
                borderTopColor: "#C49030",
                animation: "spin 1s linear infinite",
              }}
            />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                color: "#F0DEB8",
                fontSize: "1.25rem",
                fontWeight: 700,
              }}
            >
              Confirming payment…
            </h1>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                color: "#8A6840",
                fontSize: "0.875rem",
                textAlign: "center",
              }}
            >
              Please wait while PayFast confirms your subscription.
            </p>
          </>
        )}

        {status === "ready" && (
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
              You&apos;re all set!
            </h1>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                color: "#8A6840",
                fontSize: "0.875rem",
                textAlign: "center",
              }}
            >
              Your Basic plan is now active. Welcome to FarmTrack.
            </p>
            <button
              onClick={handleGoToFarm}
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
                cursor: "pointer",
              }}
            >
              Go to my farm
            </button>
          </>
        )}

        {status === "missing-farm" && (
          <>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "rgba(196,144,48,0.1)",
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
                stroke="#C49030"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                color: "#F0DEB8",
                fontSize: "1.25rem",
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              We couldn&apos;t identify your farm
            </h1>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                color: "#8A6840",
                fontSize: "0.875rem",
                textAlign: "center",
              }}
            >
              This page needs a farm context to confirm your subscription.
              Return to your dashboard to continue, or contact support if the
              issue persists.
            </p>
            <button
              onClick={handleRecoverFromMissingFarm}
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
                cursor: "pointer",
              }}
            >
              Go to my farms
            </button>
          </>
        )}

        {status === "timeout" && (
          <>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "rgba(196,144,48,0.1)",
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
                stroke="#C49030"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                color: "#F0DEB8",
                fontSize: "1.25rem",
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              Payment received
            </h1>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                color: "#8A6840",
                fontSize: "0.875rem",
                textAlign: "center",
              }}
            >
              It&apos;s taking a moment to confirm. If you completed payment, your account will
              activate shortly — try signing in again.
            </p>
            <button
              onClick={handleGoToFarm}
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
                cursor: "pointer",
              }}
            >
              Continue to farm
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function SubscribeCompletePage() {
  return (
    <Suspense>
      <CompleteContent />
    </Suspense>
  );
}
