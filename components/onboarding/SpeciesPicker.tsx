"use client";

/**
 * Step 1 species tile picker.
 *
 * Four equally weighted tiles in a 2×2 grid (2×4 on md+). Uses plain emoji
 * icons rather than a lucide dependency to keep this component self-contained
 * and the wizard bundle small. Controlled — the parent owns the selected
 * value via `OnboardingProvider`.
 */

import type { OnboardingSpecies } from "@/lib/onboarding/client-types";

type Props = {
  value: OnboardingSpecies;
  onChange: (species: OnboardingSpecies) => void;
};

type Tile = {
  species: OnboardingSpecies;
  label: string;
  emoji: string;
};

const TILES: Tile[] = [
  { species: "cattle", label: "Cattle", emoji: "🐄" },
  { species: "sheep", label: "Sheep", emoji: "🐑" },
  { species: "goats", label: "Goats", emoji: "🐐" },
  { species: "game", label: "Game", emoji: "🦌" },
];

export function SpeciesPicker({ value, onChange }: Props) {
  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-4"
      role="radiogroup"
      aria-label="Choose primary species"
    >
      {TILES.map((tile) => {
        const active = tile.species === value;
        return (
          <button
            key={tile.species}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(tile.species)}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl p-6 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            style={{
              background: active ? "rgba(196,144,48,0.12)" : "#241C14",
              border: active
                ? "1.5px solid #C49030"
                : "1px solid rgba(140,100,60,0.25)",
              boxShadow: active
                ? "0 0 28px rgba(196,144,48,0.22), 0 6px 24px rgba(0,0,0,0.4)"
                : "0 4px 16px rgba(0,0,0,0.3)",
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: "2.25rem", lineHeight: 1 }} aria-hidden="true">
              {tile.emoji}
            </span>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "0.9375rem",
                fontWeight: 600,
                color: active ? "#F0DEB8" : "#C9B48A",
                letterSpacing: "0.01em",
              }}
            >
              {tile.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
