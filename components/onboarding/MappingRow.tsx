"use client";

/**
 * One AI-proposed column mapping, ready for farmer confirmation.
 *
 * Layout on md+:
 *   [Source column + sample chips]  →  [Target <select> + pencil]   [Confidence pill / Ignore]
 *                                   ↑ animated amber arrow
 *
 * The row lifts slightly on hover and draws attention to the animated
 * source→target arrow (bounces right once per hover). Ignored rows fade
 * and disable the select. Hints (transform string, fuzzy_matches, approximate
 * warning) surface below the row in a typed-letterpress strip.
 */

import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  EyeOff,
  Eye,
  Pencil,
} from "lucide-react";
import type { ProposalResult } from "@/lib/onboarding/client-types";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { ONBOARDING_COLORS, SPRING_SOFT } from "./theme";

type ProposalMapping = ProposalResult["proposal"]["mapping"][number];

type Props = {
  mapping: ProposalMapping;
  sampleValues: string[];
  effectiveTarget: string;
  targetOptions: Array<{ value: string; label: string }>;
  onTargetChange: (target: string) => void;
  onIgnore: () => void;
  ignored: boolean;
};

export function MappingRow({
  mapping,
  sampleValues,
  effectiveTarget,
  targetOptions,
  onTargetChange,
  onIgnore,
  ignored,
}: Props) {
  const samples = sampleValues.slice(0, 3).map((s) =>
    s.length > 28 ? `${s.slice(0, 25)}…` : s,
  );

  return (
    <motion.div
      layout
      whileHover={ignored ? undefined : { y: -2 }}
      transition={SPRING_SOFT}
      className="relative overflow-hidden rounded-2xl px-4 py-4 md:px-5"
      style={{
        background:
          "linear-gradient(180deg, rgba(44,34,24,0.85) 0%, rgba(31,24,16,0.95) 100%)",
        border: "1px solid rgba(196,144,48,0.22)",
        boxShadow: "0 1px 0 rgba(245,235,212,0.04) inset, 0 6px 20px rgba(0,0,0,0.35)",
        opacity: ignored ? 0.5 : 1,
      }}
    >
      {/* Subtle left copper stripe */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{
          background: ignored
            ? "linear-gradient(180deg, rgba(140,100,60,0.3) 0%, rgba(140,100,60,0.1) 100%)"
            : "linear-gradient(180deg, rgba(229,185,100,0.6) 0%, rgba(160,82,45,0.4) 100%)",
        }}
      />

      <div className="relative flex flex-col gap-4 pl-3 md:flex-row md:items-center md:gap-5">
        {/* Source column + samples */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[0.95rem] font-semibold"
              style={{
                color: ONBOARDING_COLORS.cream,
                fontFamily: "var(--font-display)",
                textDecoration: ignored ? "line-through" : "none",
                textDecorationColor: "rgba(196,144,48,0.5)",
                letterSpacing: "-0.005em",
              }}
            >
              {mapping.source}
            </span>
          </div>
          {samples.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {samples.map((v, i) => (
                <span
                  key={`${v}-${i}`}
                  className="inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-[11px]"
                  style={{
                    background: "rgba(31,24,16,0.9)",
                    border: "1px solid rgba(196,144,48,0.16)",
                    color: ONBOARDING_COLORS.muted,
                    fontFamily: "var(--font-mono, ui-monospace)",
                  }}
                >
                  {v}
                </span>
              ))}
            </div>
          ) : (
            <div
              className="mt-1 text-[11px] italic"
              style={{ color: ONBOARDING_COLORS.whisper }}
            >
              (no sample values)
            </div>
          )}
        </div>

        {/* Arrow */}
        <motion.div
          aria-hidden="true"
          className="hidden md:flex items-center justify-center shrink-0"
          style={{ color: ignored ? ONBOARDING_COLORS.smoke : ONBOARDING_COLORS.amber }}
          initial={{ x: -4, opacity: 0.7 }}
          whileHover={{ x: 0, opacity: 1 }}
          transition={SPRING_SOFT}
        >
          <ArrowRight size={16} strokeWidth={2} />
        </motion.div>

        {/* Target select */}
        <div className="min-w-0 md:flex-1 md:max-w-xs">
          <label
            className="block text-[10px] uppercase tracking-[0.2em]"
            style={{
              color: ONBOARDING_COLORS.whisper,
              fontFamily: "var(--font-sans)",
            }}
          >
            Maps to
          </label>
          <div className="relative mt-1">
            <select
              value={effectiveTarget}
              disabled={ignored}
              onChange={(e) => onTargetChange(e.target.value)}
              className="w-full appearance-none rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/60 disabled:cursor-not-allowed"
              style={{
                background: "rgba(20,16,11,0.9)",
                border: "1px solid rgba(196,144,48,0.3)",
                color: ONBOARDING_COLORS.parchment,
                fontFamily: "var(--font-sans)",
              }}
              aria-label={`Target field for ${mapping.source}`}
            >
              {targetOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: ONBOARDING_COLORS.mutedDim }}
            >
              <Pencil size={13} strokeWidth={2} />
            </span>
          </div>
        </div>

        {/* Confidence + Ignore */}
        <div className="flex items-center gap-2 shrink-0 md:flex-col md:items-end md:gap-1.5">
          <ConfidenceBadge confidence={mapping.confidence} />
          <button
            type="button"
            onClick={onIgnore}
            className="inline-flex items-center gap-1 text-[11px] underline-offset-4 hover:underline"
            style={{
              color: ignored
                ? ONBOARDING_COLORS.amberBright
                : ONBOARDING_COLORS.mutedDim,
              fontFamily: "var(--font-sans)",
            }}
            aria-pressed={ignored}
          >
            {ignored ? <Eye size={11} /> : <EyeOff size={11} />}
            {ignored ? "Un-ignore" : "Ignore"}
          </button>
        </div>
      </div>

      {/* Hints strip */}
      {(mapping.transform ||
        (mapping.fuzzy_matches && mapping.fuzzy_matches.length > 0) ||
        mapping.approximate) && (
        <div
          className="mt-3 flex flex-col gap-1.5 border-t pt-3 pl-3"
          style={{ borderColor: "rgba(196,144,48,0.16)" }}
        >
          {mapping.transform ? (
            <div
              className="flex items-center gap-2 text-[11.5px]"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              <span
                className="uppercase tracking-[0.22em] text-[9.5px]"
                style={{ color: ONBOARDING_COLORS.mutedDim }}
              >
                Transform
              </span>
              <span style={{ color: ONBOARDING_COLORS.muted }}>
                {mapping.transform}
              </span>
            </div>
          ) : null}

          {mapping.fuzzy_matches && mapping.fuzzy_matches.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-1.5 text-[11.5px]"
              style={{ color: ONBOARDING_COLORS.mutedDim, fontFamily: "var(--font-sans)" }}
            >
              <span
                className="uppercase tracking-[0.22em] text-[9.5px]"
                style={{ color: ONBOARDING_COLORS.mutedDim }}
              >
                Fuzzy
              </span>
              {mapping.fuzzy_matches.map((fm) => (
                <span
                  key={`${fm.source_value}->${fm.camp_id}`}
                  className="rounded-md px-1.5 py-0.5 text-[10.5px]"
                  style={{
                    background: "rgba(196,144,48,0.08)",
                    border: "1px solid rgba(196,144,48,0.22)",
                    color: ONBOARDING_COLORS.parchment,
                    fontFamily: "var(--font-mono, ui-monospace)",
                  }}
                >
                  {fm.source_value} → {fm.camp_id}
                </span>
              ))}
            </div>
          ) : null}

          {mapping.approximate ? (
            <div
              className="inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px]"
              style={{
                background: "rgba(217,164,65,0.1)",
                border: "1px solid rgba(217,164,65,0.3)",
                color: ONBOARDING_COLORS.parchment,
                fontFamily: "var(--font-sans)",
              }}
            >
              <AlertTriangle size={11} strokeWidth={2.2} />
              Approximate values — dates may be imprecise
            </div>
          ) : null}
        </div>
      )}
    </motion.div>
  );
}
