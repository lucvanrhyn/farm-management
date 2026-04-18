"use client";

/**
 * Shared wrapper for every onboarding step page.
 *
 * Renders the parchment card with a subtle grain overlay, an editorial eyebrow
 * (step label in Playfair small-caps), a display heading, and optional lead
 * paragraph. Children slot below with page-entrance spring motion.
 *
 * Keeping the scaffolding here means the individual step pages can focus on
 * their specific business logic without re-declaring boilerplate style objects.
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { PARCHMENT_CARD, pageEnter } from "./theme";

type StepShellProps = {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  /** When true, removes the parchment card chrome — used by pages that want
   *  full-bleed layouts (e.g. the import-progress ring). */
  bareChildren?: boolean;
  /** Optional slot that renders above the heading, e.g. a file chip. */
  aboveHeading?: ReactNode;
};

export function StepShell({
  eyebrow,
  title,
  lead,
  children,
  bareChildren = false,
  aboveHeading,
}: StepShellProps) {
  return (
    <motion.div
      variants={pageEnter}
      initial="hidden"
      animate="show"
      className="relative mt-6 overflow-hidden rounded-[2rem]"
      style={bareChildren ? undefined : PARCHMENT_CARD}
    >
      {/* Grain overlay — only render when the card chrome is present */}
      {!bareChildren && <GrainOverlay />}

      <div className={bareChildren ? "relative" : "relative px-6 py-8 md:px-10 md:py-10"}>
        {aboveHeading}
        <motion.p
          variants={pageEnter}
          className="mb-2 text-[11px] uppercase tracking-[0.22em]"
          style={{
            color: "#C49030",
            fontFamily: "var(--font-sans)",
          }}
        >
          {eyebrow}
        </motion.p>
        <motion.h1
          variants={pageEnter}
          className="text-[1.75rem] md:text-[2.25rem] leading-[1.1] font-semibold"
          style={{
            color: "#F5EBD4",
            fontFamily: "var(--font-display)",
            letterSpacing: "-0.015em",
          }}
        >
          {title}
        </motion.h1>
        {lead ? (
          <motion.p
            variants={pageEnter}
            className="mt-3 max-w-[52ch] text-[0.95rem] leading-[1.65]"
            style={{
              color: "#C9B48A",
              fontFamily: "var(--font-sans)",
            }}
          >
            {lead}
          </motion.p>
        ) : null}

        {/* Decorative hairline with diamond glyph under the hero */}
        <div
          className="my-6 flex items-center gap-3"
          aria-hidden="true"
        >
          <div
            className="h-px flex-1"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(196,144,48,0.35) 50%, transparent 100%)",
            }}
          />
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
            <rect
              x="4"
              y="0"
              width="5.66"
              height="5.66"
              transform="rotate(45 4 0)"
              fill="rgba(196,144,48,0.45)"
            />
          </svg>
          <div
            className="h-px flex-1"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(196,144,48,0.35) 50%, transparent 100%)",
            }}
          />
        </div>

        {children}
      </div>
    </motion.div>
  );
}

/**
 * Subtle SVG-noise grain overlay. Tuned to be nearly invisible but give the
 * parchment surface a tactile feel. Non-interactive, purely decorative.
 */
export function GrainOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.95 0 0 0 0 0.75 0 0 0 0 0.4 0 0 0 1 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        backgroundSize: "180px 180px",
      }}
    />
  );
}
