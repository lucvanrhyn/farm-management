"use client";

/**
 * Species tile picker — 4 large copper-ringed tiles with spring motion.
 *
 * Controlled by OnboardingProvider. Keeps emoji as a warm visual hero
 * (species read as livestock, not abstract icons) with a small lucide
 * glyph in the corner for refinement. Active tile draws an amber ring +
 * inner parchment glow; inactive tiles lift slightly on hover.
 */

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { OnboardingSpecies } from "@/lib/onboarding/client-types";
import { ONBOARDING_COLORS, SPRING_SOFT, staggerContainer } from "./theme";

type Props = {
  value: OnboardingSpecies;
  onChange: (species: OnboardingSpecies) => void;
};

type Tile = {
  species: OnboardingSpecies;
  label: string;
  emoji: string;
  /** Short italicized tagline shown under the label. */
  caption: string;
};

const TILES: Tile[] = [
  { species: "cattle", label: "Cattle", emoji: "🐄", caption: "Herds & breeding" },
  { species: "sheep", label: "Sheep", emoji: "🐑", caption: "Flocks & wool" },
  { species: "goats", label: "Goats", emoji: "🐐", caption: "Browsers & dairy" },
  { species: "game", label: "Game", emoji: "🦌", caption: "Wildlife & yield" },
];

const tileVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: SPRING_SOFT },
};

export function SpeciesPicker({ value, onChange }: Props) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4"
      role="radiogroup"
      aria-label="Choose primary species"
    >
      {TILES.map((tile) => {
        const active = tile.species === value;
        return (
          <motion.button
            key={tile.species}
            variants={tileVariants}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(tile.species)}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.97 }}
            transition={SPRING_SOFT}
            className="group relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[1.25rem] px-4 py-6 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1A1510] focus-visible:ring-amber-400"
            style={{
              background: active
                ? "linear-gradient(180deg, rgba(229,185,100,0.14) 0%, rgba(196,144,48,0.06) 100%)"
                : "rgba(31,24,16,0.75)",
              border: active
                ? `1.5px solid ${ONBOARDING_COLORS.amber}`
                : "1px solid rgba(140,100,60,0.25)",
              boxShadow: active
                ? "0 0 34px rgba(196,144,48,0.28), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(245,235,212,0.08) inset"
                : "0 4px 16px rgba(0,0,0,0.3)",
              cursor: "pointer",
            }}
          >
            {/* Active ring/glow corner check */}
            {active ? (
              <motion.span
                initial={{ scale: 0, rotate: -45 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 24 }}
                aria-hidden="true"
                className="absolute right-2.5 top-2.5 flex size-4 items-center justify-center rounded-full"
                style={{
                  background: ONBOARDING_COLORS.amber,
                  color: ONBOARDING_COLORS.bg,
                }}
              >
                <Check size={10} strokeWidth={3} />
              </motion.span>
            ) : null}

            {/* Emoji hero — let it breathe on hover */}
            <motion.span
              aria-hidden="true"
              className="select-none"
              style={{ fontSize: "2.4rem", lineHeight: 1 }}
              animate={active ? { y: [-1, 1, -1] } : { y: 0 }}
              transition={
                active
                  ? { duration: 3, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.2 }
              }
            >
              {tile.emoji}
            </motion.span>

            <span
              className="text-[0.95rem] font-semibold tracking-[0.01em]"
              style={{
                fontFamily: "var(--font-display)",
                color: active ? ONBOARDING_COLORS.cream : ONBOARDING_COLORS.muted,
              }}
            >
              {tile.label}
            </span>
            <span
              className="text-[11px] italic"
              style={{
                fontFamily: "var(--font-sans)",
                color: active ? ONBOARDING_COLORS.amberBright : ONBOARDING_COLORS.whisper,
                letterSpacing: "0.02em",
              }}
            >
              {tile.caption}
            </span>
          </motion.button>
        );
      })}
    </motion.div>
  );
}
