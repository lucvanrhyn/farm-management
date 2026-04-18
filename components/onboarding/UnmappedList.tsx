"use client";

/**
 * Columns the AI couldn't place with confidence.
 *
 * Dashed-border cards in a warm "pending" tone. Each shows sample values,
 * the AI's upsell hint (consulting-tier fodder), and a target select the
 * farmer can use to rescue the column.
 */

import { motion } from "framer-motion";
import { HelpCircle } from "lucide-react";
import type { ProposalResult } from "@/lib/onboarding/client-types";
import { ONBOARDING_COLORS, SPRING_SOFT, staggerContainer } from "./theme";

type Props = {
  unmapped: ProposalResult["proposal"]["unmapped"];
  unmappedOverrides: Record<string, string>;
  targetOptions: Array<{ value: string; label: string }>;
  onAssign: (source: string, target: string) => void;
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: SPRING_SOFT },
};

export function UnmappedList({
  unmapped,
  unmappedOverrides,
  targetOptions,
  onAssign,
}: Props) {
  if (!unmapped || unmapped.length === 0) {
    return null;
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <HelpCircle size={15} className="text-amber-400/80" strokeWidth={2} />
        <h3
          className="text-[1rem] font-semibold"
          style={{
            color: ONBOARDING_COLORS.cream,
            fontFamily: "var(--font-display)",
            letterSpacing: "-0.005em",
          }}
        >
          Columns we couldn&apos;t place
        </h3>
      </div>
      <p
        className="mb-4 text-[12.5px] italic"
        style={{
          color: ONBOARDING_COLORS.mutedDim,
          fontFamily: "var(--font-sans)",
          maxWidth: "60ch",
        }}
      >
        These look like custom data the core importer doesn&apos;t handle. Leave
        them unmapped to skip, or assign a target if we missed something.
      </p>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-3"
      >
        {unmapped.map((item) => {
          const samples = item.samples
            .slice(0, 3)
            .map((s) => (s.length > 28 ? `${s.slice(0, 25)}…` : s));
          const current = unmappedOverrides[item.source] ?? "";

          return (
            <motion.div
              key={item.source}
              variants={itemVariants}
              className="relative overflow-hidden rounded-2xl px-4 py-4"
              style={{
                background: "rgba(26,21,16,0.85)",
                border: "1px dashed rgba(196,144,48,0.35)",
              }}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[0.9rem] font-semibold"
                    style={{
                      color: ONBOARDING_COLORS.cream,
                      fontFamily: "var(--font-display)",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    {item.source}
                  </div>
                  {samples.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {samples.map((v, i) => (
                        <span
                          key={`${v}-${i}`}
                          className="inline-flex rounded-md px-1.5 py-0.5 text-[11px]"
                          style={{
                            background: "rgba(20,16,11,0.9)",
                            border: "1px solid rgba(196,144,48,0.16)",
                            color: ONBOARDING_COLORS.muted,
                            fontFamily: "var(--font-mono, ui-monospace)",
                          }}
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.upsell_hint ? (
                    <div
                      className="mt-2 text-[11px] italic"
                      style={{
                        color: ONBOARDING_COLORS.whisper,
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      Hint: {item.upsell_hint}
                    </div>
                  ) : null}
                </div>

                <div className="min-w-0 md:max-w-xs md:flex-1">
                  <label
                    className="block text-[10px] uppercase tracking-[0.2em]"
                    style={{
                      color: ONBOARDING_COLORS.whisper,
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    Assign target
                  </label>
                  <select
                    value={current}
                    onChange={(e) => onAssign(item.source, e.target.value)}
                    className="mt-1 w-full appearance-none rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/60"
                    style={{
                      background: "rgba(20,16,11,0.9)",
                      border: "1px solid rgba(196,144,48,0.3)",
                      color: ONBOARDING_COLORS.parchment,
                      fontFamily: "var(--font-sans)",
                    }}
                    aria-label={`Assign target for ${item.source}`}
                  >
                    <option value="">— Leave unmapped —</option>
                    {targetOptions
                      .filter((opt) => opt.value !== "__ignored__")
                      .map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </section>
  );
}
