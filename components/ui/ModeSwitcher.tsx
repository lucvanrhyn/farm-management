"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useFarmMode, type FarmMode } from "@/lib/farm-mode";
import { AddSpeciesUpsellDialog } from "./AddSpeciesUpsellDialog";

const MODE_CONFIG: Record<FarmMode, { label: string; emoji: string }> = {
  cattle: { label: "Cattle", emoji: "🐄" },
  sheep:  { label: "Sheep",  emoji: "🐑" },
  game:   { label: "Game",   emoji: "🦌" },
};

interface ModeSwitcherProps {
  /** "glass" for home page overlay, "solid" for admin sidebar */
  readonly variant?: "glass" | "solid";
  /**
   * Issue #235 — opt-out: pass `false` to force-hide the
   * "+ Add species" upsell pill regardless of the tenant's actual
   * species distribution. Default `undefined` reads
   * `hasMultipleSpecies` from `FarmModeProvider` (sourced server-side
   * by `[farmSlug]/layout` via `getCachedHasMultipleActiveSpecies`),
   * so the prop is only needed for surfaces that explicitly want to
   * suppress the upsell (e.g. logger UI where the bar is purely a
   * mode-pick affordance).
   */
  readonly showUpsell?: boolean;
}

export function ModeSwitcher({
  variant = "glass",
  showUpsell,
}: ModeSwitcherProps) {
  const { mode, setMode, enabledModes, hasMultipleSpecies } = useFarmMode();
  const [upsellOpen, setUpsellOpen] = useState(false);

  // Default policy: show the upsell pill iff the tenant actually has
  // only one species. Callers can force-disable via `showUpsell={false}`.
  const wantsUpsell = showUpsell ?? !hasMultipleSpecies;

  // Pre-#235 behaviour: with only one enabled mode AND no upsell to show,
  // the bar adds clutter — hide it. With a single mode and the upsell
  // flag, render so the dimmed "+ Add species" pill is visible.
  if (enabledModes.length <= 1 && !wantsUpsell) return null;

  const isGlass = variant === "glass";

  const containerStyle = isGlass
    ? {
        background: "rgba(5,3,1,0.52)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.07)",
      }
    : {
        background: "rgba(139,105,20,0.08)",
        border: "1px solid rgba(139,105,20,0.15)",
      };

  return (
    <>
      <div
        className="inline-flex items-center gap-1 rounded-2xl p-1"
        style={containerStyle}
      >
        {enabledModes.map((m) => {
          const config = MODE_CONFIG[m];
          const isActive = m === mode;

          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors"
              style={{
                color: isActive
                  ? isGlass ? "#F5EBD4" : "#F5EBD4"
                  : isGlass ? "rgba(210,180,140,0.6)" : "rgba(210,180,140,0.65)",
              }}
            >
              {isActive && (
                <motion.div
                  layoutId="mode-switcher-bg"
                  className="absolute inset-0 rounded-xl"
                  style={
                    isGlass
                      ? {
                          background: "rgba(196,144,48,0.25)",
                          border: "1px solid rgba(196,144,48,0.3)",
                        }
                      : {
                          background: "rgba(139,105,20,0.2)",
                          border: "1px solid rgba(139,105,20,0.3)",
                        }
                  }
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <span className="relative z-10">{config.emoji}</span>
              <span className="relative z-10">{config.label}</span>
            </button>
          );
        })}

        {wantsUpsell && (
          <button
            type="button"
            aria-disabled="true"
            onClick={() => setUpsellOpen(true)}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium opacity-50 hover:opacity-70 transition-opacity"
            style={{
              color: isGlass
                ? "rgba(210,180,140,0.6)"
                : "rgba(210,180,140,0.65)",
            }}
          >
            <span className="relative z-10">+ Add species</span>
          </button>
        )}
      </div>

      {wantsUpsell && (
        <AddSpeciesUpsellDialog
          open={upsellOpen}
          onClose={() => setUpsellOpen(false)}
        />
      )}
    </>
  );
}
