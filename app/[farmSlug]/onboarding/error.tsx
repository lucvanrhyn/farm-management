"use client";

/**
 * Segment-scoped error boundary. Keeps render failures inside the wizard
 * (corrupt sessionStorage payload, malformed ProposalResult, XLSX regression)
 * and offers a one-click reset that clears storage + retries the segment.
 */

import { useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { ONBOARDING_COLORS } from "@/components/onboarding/theme";
import { ONBOARDING_STORAGE_KEY } from "@/lib/onboarding/storage";
import { clientLogger } from "@/lib/client-logger";

export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    clientLogger.warn("[onboarding] boundary caught", { error });
  }, [error]);

  const handleReset = () => {
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(ONBOARDING_STORAGE_KEY);
      }
    } catch {
      /* ignore — storage may be disabled */
    }
    reset();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 90, damping: 22 }}
      className="relative mt-6 overflow-hidden rounded-[2rem] px-8 py-10 text-center"
      style={{
        background:
          "linear-gradient(180deg, #2C2218 0%, #241C14 100%)",
        border: "1px solid rgba(200,81,58,0.35)",
        boxShadow:
          "0 1px 0 rgba(245,235,212,0.04) inset, 0 0 48px rgba(200,81,58,0.08), 0 12px 40px rgba(0,0,0,0.55)",
      }}
    >
      <motion.div
        initial={{ scale: 0.6, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 180, damping: 18, delay: 0.05 }}
        aria-hidden="true"
        className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full"
        style={{
          background: "rgba(200,81,58,0.15)",
          border: "1px solid rgba(200,81,58,0.45)",
          color: "#E88C78",
        }}
      >
        <AlertTriangle size={22} strokeWidth={2.2} />
      </motion.div>

      <h1
        className="mb-2"
        style={{
          color: ONBOARDING_COLORS.cream,
          fontFamily: "var(--font-display)",
          fontSize: "1.55rem",
          fontWeight: 700,
        }}
      >
        The ledger jammed
      </h1>

      <p
        className="mx-auto max-w-[44ch] text-[0.9375rem] leading-[1.6]"
        style={{
          color: ONBOARDING_COLORS.muted,
          fontFamily: "var(--font-sans)",
        }}
      >
        Something went sideways rendering the wizard. Resetting your draft usually
        clears it — nothing has been written to your farm yet.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={handleReset}
          className="group inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-all"
          style={{
            background:
              "linear-gradient(135deg, rgba(229,185,100,0.95) 0%, rgba(196,144,48,0.95) 45%, rgba(160,82,45,0.95) 100%)",
            color: "#1A1510",
            boxShadow: "0 6px 24px rgba(196,144,48,0.35)",
            fontFamily: "var(--font-sans)",
          }}
        >
          <RotateCw size={14} strokeWidth={2.5} className="transition-transform group-hover:rotate-45" />
          Reset and try again
        </button>
        <Link
          href="/"
          className="text-sm underline-offset-4 hover:underline"
          style={{
            color: ONBOARDING_COLORS.muted,
            fontFamily: "var(--font-sans)",
          }}
        >
          Back to home
        </Link>
      </div>

      {error.digest ? (
        <p
          className="mt-6 text-[10px] tracking-wider"
          style={{
            color: "#3A2A1A",
            fontFamily: "var(--font-mono, ui-monospace)",
          }}
        >
          ref · {error.digest}
        </p>
      ) : null}
    </motion.div>
  );
}
