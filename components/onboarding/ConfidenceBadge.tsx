"use client";

/**
 * Confidence band pill.
 *
 * >= 0.85  -> green  (High, auto-safe)
 * 0.5–0.85 -> amber  (Review)
 * <  0.5   -> rust   (Manual — pulses to attract attention)
 *
 * Colours are hand-mixed to read warm on the parchment theme rather than
 * using stock Tailwind greens/yellows/reds. Manual-band pills pulse softly
 * so they stand out on a mapping page full of green/amber rows.
 */

import { motion } from "framer-motion";
import { ONBOARDING_COLORS } from "./theme";

type Props = { confidence: number };

type BandName = "High" | "Review" | "Manual";

type Band = {
  label: BandName;
  bg: string;
  ink: string;
  border: string;
  ring: string;
};

function bandFor(confidence: number): Band {
  if (confidence >= 0.85) {
    return {
      label: "High",
      bg: ONBOARDING_COLORS.bandHigh,
      ink: ONBOARDING_COLORS.cream,
      border: ONBOARDING_COLORS.bandHighBorder,
      ring: "rgba(107,147,98,0.35)",
    };
  }
  if (confidence >= 0.5) {
    return {
      label: "Review",
      bg: ONBOARDING_COLORS.bandReview,
      ink: ONBOARDING_COLORS.bandReviewInk,
      border: ONBOARDING_COLORS.bandReviewBorder,
      ring: "rgba(217,164,65,0.35)",
    };
  }
  return {
    label: "Manual",
    bg: ONBOARDING_COLORS.bandManual,
    ink: ONBOARDING_COLORS.cream,
    border: ONBOARDING_COLORS.bandManualBorder,
    ring: "rgba(200,81,58,0.45)",
  };
}

export function ConfidenceBadge({ confidence }: Props) {
  const band = bandFor(confidence);
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  const isManual = band.label === "Manual";

  return (
    <span
      data-band={band.label}
      className="relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      title={`Confidence: ${pct}% — ${
        band.label === "High"
          ? "High confidence"
          : band.label === "Review"
            ? "Review suggested"
            : "Manual mapping required"
      }`}
      style={{
        background: band.bg,
        color: band.ink,
        border: `1px solid ${band.border}`,
        fontFamily: "var(--font-sans)",
        letterSpacing: "0.01em",
        boxShadow: `0 0 14px ${band.ring}`,
      }}
    >
      {/* Status dot — pulses on Manual so attention is drawn */}
      <span
        aria-hidden="true"
        className="relative inline-flex size-1.5 items-center justify-center"
      >
        <span
          className="size-1.5 rounded-full"
          style={{ background: band.ink, opacity: 0.9 }}
        />
        {isManual ? (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ background: band.ink }}
            animate={{ scale: [1, 2.2, 1], opacity: [0.7, 0, 0.7] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        ) : null}
      </span>
      {pct}% · {band.label}
    </span>
  );
}
