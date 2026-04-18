"use client";

/**
 * Step 5 — import summary.
 *
 * Shows inserted/skipped/error counts from `state.result`. If a user hits this
 * route directly (no result present) we bounce them to the start of the
 * wizard rather than rendering an empty success screen. Leaving the wizard
 * clears the sessionStorage payload so a second farm onboarding starts fresh.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";

const MAX_VISIBLE_ERRORS = 10;

export default function OnboardingDonePage() {
  const router = useRouter();
  const params = useParams<{ farmSlug: string }>();
  const farmSlug = params.farmSlug;
  const { state, reset } = useOnboarding();
  const [showAllErrors, setShowAllErrors] = useState(false);
  // Flip after the Provider's hydration effect has had a chance to run. Using
  // a hydrated flag instead of a 100 ms timeout avoids false redirects on
  // slow devices where sessionStorage access lags past the timeout window
  // (see Phase 2 review MEDIUM — fragile timeout guard).
  const [hydrated, setHydrated] = useState(false);

  const result = state.result;

  // One mount-time effect schedules the hydrated flip to the next tick, which
  // runs after React has flushed the Provider's HYDRATE dispatch.
  useEffect(() => {
    const handle = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(handle);
  }, []);

  // Direct-URL guard — only redirect once the provider has hydrated AND still
  // has no result. Users who legitimately just finished an import land here
  // with result already present, so the redirect never fires.
  useEffect(() => {
    if (!hydrated || result || !farmSlug) return;
    router.replace(`/${farmSlug}/onboarding`);
  }, [hydrated, result, farmSlug, router]);

  const visibleErrors = useMemo(() => {
    if (!result) return [];
    return showAllErrors
      ? result.errors
      : result.errors.slice(0, MAX_VISIBLE_ERRORS);
  }, [result, showAllErrors]);

  if (!result) {
    // Render nothing while the redirect effect runs. Avoids a flash of empty
    // state on hard refresh.
    return null;
  }

  function goToAdmin() {
    if (!farmSlug) return;
    reset();
    router.push(`/${farmSlug}/admin`);
  }

  function importMore() {
    if (!farmSlug) return;
    reset();
    router.push(`/${farmSlug}/onboarding/upload`);
  }

  const hasErrors = result.errors.length > 0;

  return (
    <div
      className="mt-6 flex flex-col gap-6 rounded-[2rem] px-8 py-8"
      style={{
        background: "#241C14",
        border: "1px solid rgba(196,144,48,0.18)",
        boxShadow:
          "0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)",
      }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span style={{ fontSize: "3rem", lineHeight: 1 }} aria-hidden="true">
          ✅
        </span>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            color: "#F0DEB8",
            fontSize: "1.75rem",
            fontWeight: 700,
          }}
        >
          Import complete!
        </h2>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#8A6840",
            fontSize: "0.9375rem",
          }}
        >
          Your herd is now live in FarmTrack.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Imported" value={result.inserted} tone="success" />
        <Stat label="Skipped" value={result.skipped} tone="neutral" />
        <Stat
          label="Errors"
          value={result.errors.length}
          tone={hasErrors ? "warning" : "neutral"}
        />
      </div>

      {hasErrors && (
        <div className="flex flex-col gap-2">
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#F0DEB8",
              fontSize: "0.9375rem",
              fontWeight: 600,
            }}
          >
            Rows that couldn&apos;t be imported
          </p>
          <ul
            className="flex flex-col divide-y rounded-lg"
            style={{
              background: "rgba(15,9,3,0.4)",
              border: "1px solid rgba(140,100,60,0.2)",
              ["--tw-divide-opacity" as string]: "1",
            }}
          >
            {visibleErrors.map((err, idx) => (
              <li
                key={`${err.row}-${idx}`}
                className="flex items-start gap-3 px-4 py-2.5"
                style={{ borderBottom: "1px solid rgba(140,100,60,0.15)" }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono, ui-monospace)",
                    color: "#6A4E30",
                    fontSize: "0.75rem",
                    minWidth: "3.5rem",
                  }}
                >
                  Row {err.row}
                </span>
                {err.earTag && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono, ui-monospace)",
                      color: "#C9B48A",
                      fontSize: "0.75rem",
                      minWidth: "5rem",
                    }}
                  >
                    {err.earTag}
                  </span>
                )}
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    color: "#F5C2B5",
                    fontSize: "0.8125rem",
                  }}
                >
                  {err.reason}
                </span>
              </li>
            ))}
          </ul>
          {!showAllErrors && result.errors.length > MAX_VISIBLE_ERRORS && (
            <button
              type="button"
              onClick={() => setShowAllErrors(true)}
              style={{
                alignSelf: "flex-start",
                color: "#C49030",
                fontFamily: "var(--font-sans)",
                fontSize: "0.8125rem",
                textDecoration: "underline",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Show {result.errors.length - MAX_VISIBLE_ERRORS} more
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="lg" onClick={goToAdmin}>
          Go to Admin
        </Button>
        <button
          type="button"
          onClick={importMore}
          style={{
            color: "#C49030",
            fontFamily: "var(--font-sans)",
            fontSize: "0.875rem",
            textDecoration: "underline",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          Import more animals
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "neutral";
}) {
  const accent =
    tone === "success" ? "#8FBF6A" : tone === "warning" ? "#E5A44B" : "#F0DEB8";
  return (
    <div
      className="flex flex-col items-center gap-1 rounded-xl px-3 py-4"
      style={{
        background: "rgba(15,9,3,0.45)",
        border: "1px solid rgba(140,100,60,0.2)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          color: accent,
          fontSize: "1.75rem",
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: "var(--font-sans)",
          color: "#8A6840",
          fontSize: "0.75rem",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}
