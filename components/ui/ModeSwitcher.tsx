"use client";

import { motion } from "framer-motion";
import { useFarmMode, type FarmMode } from "@/lib/farm-mode";

const MODE_CONFIG: Record<FarmMode, { label: string; emoji: string }> = {
  cattle: { label: "Cattle", emoji: "\uD83D\uDC04" },
  sheep:  { label: "Sheep",  emoji: "\uD83D\uDC11" },
  game:   { label: "Game",   emoji: "\uD83E\uDD8C" },
};

interface ModeSwitcherProps {
  /** "glass" for home page overlay, "solid" for admin sidebar */
  readonly variant?: "glass" | "solid";
}

export function ModeSwitcher({ variant = "glass" }: ModeSwitcherProps) {
  const { mode, setMode, enabledModes } = useFarmMode();

  if (enabledModes.length <= 1) return null;

  const isGlass = variant === "glass";

  return (
    <div
      className="inline-flex items-center gap-1 rounded-2xl p-1"
      style={
        isGlass
          ? {
              background: "rgba(5,3,1,0.52)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              border: "1px solid rgba(255,255,255,0.07)",
            }
          : {
              background: "rgba(139,105,20,0.08)",
              border: "1px solid rgba(139,105,20,0.15)",
            }
      }
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
