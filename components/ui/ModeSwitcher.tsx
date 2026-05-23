"use client";

import { motion } from "framer-motion";
import { useFarmMode, type FarmMode } from "@/lib/farm-mode";

const MODE_CONFIG: Record<FarmMode, { label: string; emoji: string }> = {
  cattle: { label: "Cattle", emoji: "🐄" },
  sheep:  { label: "Sheep",  emoji: "🐑" },
  game:   { label: "Game",   emoji: "🦌" },
};

interface ModeSwitcherProps {
  /** "glass" for home page overlay, "solid" for admin sidebar */
  readonly variant?: "glass" | "solid";
  /**
   * Issue #235 added a `showUpsell` prop that toggled a dimmed
   * "+ Add species" pill on single-species tenants. Issue #263
   * removed that pill entirely after user feedback ("I don't like
   * that add species thing that's everywhere... it needs to be
   * removed."). The prop is retained for backward compatibility
   * with existing call-sites but is now a no-op — single-species
   * tenants render nothing, multi-species tenants render only the
   * mode pills.
   */
  readonly showUpsell?: boolean;
}

export function ModeSwitcher({
  variant = "glass",
  showUpsell: _showUpsell,
}: ModeSwitcherProps) {
  // Reference the deprecated prop so TypeScript / lint doesn't flag it.
  void _showUpsell;

  const { mode, setMode, enabledModes } = useFarmMode();

  // #263: hide the bar entirely on single-species tenants. There is no
  // longer an "+ Add species" upsell to render, so a 1-pill bar adds
  // dead chrome to every page. The bar only renders for tenants that
  // actually have a meaningful mode toggle (≥2 enabled species).
  if (enabledModes.length <= 1) return null;

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
    </div>
  );
}
